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
	if rec := doJSON(a, http.MethodPost, "/api/money/payment-requests/preq_1/approval", `{"positions":[1,3],"all":true}`); rec.Code != http.StatusOK {
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
	if !strings.HasPrefix(got[0], "POST /v1/money/payment-requests/preq_1/approval ") || !strings.HasSuffix(got[0], ` {"positions":[1,3]}`) {
		t.Errorf("approval did not go up with only the ticked positions: %s", got[0])
	}
	if !strings.HasPrefix(got[1], "POST /v1/money/payment-requests/preq_1/approve ") || !strings.Contains(got[1], `"statement":"{\"items\":[]}"`) ||
		!strings.Contains(got[1], `"signature":"s"`) || strings.Contains(got[1], `"by"`) {
		t.Errorf("approve did not go up as the statement and assertion alone: %s", got[1])
	}
	if !strings.HasPrefix(got[2], "GET /v1/money/payment-requests/preq_1 ") {
		t.Errorf("read went to %s", got[2])
	}
}
