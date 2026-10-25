package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B40.9 — the approval screen's two writes reach Lens under the session's token with only the fields they name, and an
// approval with nothing ticked never leaves the BFF (Lens would read no positions as every item).
func TestApprovalScreenWritesReachLensAsNamed(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" auth="+r.Header.Get("Authorization")+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"preq_1","status":"approved"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/payment-requests/preq_1/approval", `{"positions":[]}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("an approval with nothing ticked = %d, want 400", rec.Code)
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/payment-requests/preq_1/approval", `{"positions":[1,3],"all":true,"reason":"re-sent invoice"}`); rec.Code != http.StatusOK {
		t.Fatalf("approval = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/payment-requests/preq_1/approve",
		`{"statement":"{\"items\":[]}","assertion":{"credential_id":"c","client_data_json":"d","authenticator_data":"a","signature":"s"},"by":"x"}`); rec.Code != http.StatusOK {
		t.Fatalf("approve = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/payment-requests/preq_1", ``); rec.Code != http.StatusOK {
		t.Fatalf("read = %d %s", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 3 {
		t.Fatalf("Lens saw %d calls, want 3:\n  %s", len(got), strings.Join(got, "\n  "))
	}
	for i, call := range got {
		if !strings.Contains(call, " auth=Bearer ") || strings.Contains(call, "auth=Bearer  ") {
			t.Errorf("call %d did not go up under the session's token: %s", i, call)
		}
	}
	if !strings.HasPrefix(got[0], "POST /v1/money/payment-requests/preq_1/approval ") || !strings.HasSuffix(got[0], ` {"positions":[1,3],"reason":"re-sent invoice"}`) {
		t.Errorf("approval did not go up with only the ticked positions and the reason: %s", got[0])
	}
	if !strings.HasPrefix(got[1], "POST /v1/money/payment-requests/preq_1/approve ") || !strings.Contains(got[1], `"statement":"{\"items\":[]}"`) ||
		!strings.Contains(got[1], `"signature":"s"`) || strings.Contains(got[1], `"by"`) {
		t.Errorf("approve did not go up as the statement and assertion alone: %s", got[1])
	}
	if !strings.HasPrefix(got[2], "GET /v1/money/payment-requests/preq_1 ") {
		t.Errorf("read went to %s", got[2])
	}
}

// B40.37 — a phone approves with its device key ({device_id, challenge, signature}); the BFF forwards those three to
// Lens as sent on each route that takes an assertion, where it used to drop device_id and challenge.
func TestDeviceAssertionReachesLensOnEveryDecisionRoute(t *testing.T) {
	var mu sync.Mutex
	got := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got[r.URL.Path] = string(raw)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"approved"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	device := `{"device_id":"dev_9","challenge":"Y2gtMQ","signature":"c2lnLTE"}`
	for _, c := range []struct{ path, body, lens string }{
		{"/api/agents/approvals/ap_1/approve", `{"assertion":` + device + `}`, "/approvals/ap_1/approve"},
		{"/api/agents/approvals/ap_2/deny", `{"assertion":` + device + `}`, "/approvals/ap_2/deny"},
		{"/api/money/payment-requests/preq_1/approve", `{"statement":"{}","assertion":` + device + `}`, "/v1/money/payment-requests/preq_1/approve"},
	} {
		if rec := doJSON(a, http.MethodPost, c.path, c.body); rec.Code != http.StatusOK {
			t.Fatalf("%s = %d %s", c.path, rec.Code, rec.Body.String())
		}
		mu.Lock()
		var body string
		for p, b := range got {
			if strings.HasSuffix(p, c.lens) {
				body = b
			}
		}
		mu.Unlock()
		for _, want := range []string{`"device_id":"dev_9"`, `"challenge":"Y2gtMQ"`, `"signature":"c2lnLTE"`} {
			if !strings.Contains(body, want) {
				t.Errorf("%s: Lens got %q, missing %s", c.path, body, want)
			}
		}
	}
}

// B40.39 — the phone's Bills due list reaches Lens's B40.38 list under the session's token with only the status, and
// Lens's {"requests": […]} comes back as it was sent.
func TestPendingPaymentRequestsListRelaysStatusOnly(t *testing.T) {
	var mu sync.Mutex
	got := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		mu.Lock()
		got = r.Method + " " + r.URL.Path + "?" + r.URL.RawQuery + " auth=" + r.Header.Get("Authorization")
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"requests":[{"id":"preq_1","status":"pending_approval"}]}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/money/payment-requests?status=pending_approval&workspace=other", ``)
	if rec.Code != http.StatusOK || rec.Body.String() != `{"requests":[{"id":"preq_1","status":"pending_approval"}]}` {
		t.Fatalf("list = %d %s", rec.Code, rec.Body.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if !strings.HasPrefix(got, "GET /v1/money/payment-requests?status=pending_approval auth=Bearer ") || strings.HasSuffix(got, "Bearer ") {
		t.Errorf("Lens saw %q, want only the status under the session's token", got)
	}
}
