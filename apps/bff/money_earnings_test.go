package main

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B55.28 — payout details, the earnings payouts and a room's payout reach Lens under the session's token with only
// the fields the screens name; a room's payout goes up under the browser's Idempotency-Key.
func TestEarningsRelaysReachLensAsNamed(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" key="+r.Header.Get("Idempotency-Key")+" auth="+r.Header.Get("Authorization")+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"pending"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPut, "/api/money/payout-details", `{"asset":"EUR","holder":"Ada Ltd","iban":"DE89370400440532013000","bic":"COBADEFFXXX","status":"verified","workspace_id":"other","partner":"x"}`); rec.Code != http.StatusOK {
		t.Fatalf("save details = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/payout-details", ""); rec.Code != http.StatusOK {
		t.Fatalf("read details = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/earnings-payouts", ""); rec.Code != http.StatusOK {
		t.Fatalf("read payouts = %d %s", rec.Code, rec.Body.String())
	}
	pay := httptest.NewRequest(http.MethodPost, "/api/rooms/room_1/payouts", strings.NewReader(`{"amount_minor":9000,"currency":"USD","shares":{"ws_a":6000,"ws_b":4000},"agent_id":"ag_other"}`))
	pay.Header.Set("Content-Type", "application/json")
	pay.Header.Set("Idempotency-Key", "pay-1")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, pay)
	if rec.Code != http.StatusOK {
		t.Fatalf("room payout = %d %s", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 4 {
		t.Fatalf("Lens saw %d calls, want 4:\n  %s", len(got), strings.Join(got, "\n  "))
	}
	for i, call := range got {
		if !strings.Contains(call, " auth=Bearer ") || strings.Contains(call, "auth=Bearer  ") {
			t.Errorf("call %d did not go up under the session's token: %s", i, call)
		}
	}
	for i, want := range []string{"PUT /v1/money/payout-details ", "GET /v1/money/payout-details ", "GET /v1/money/earnings-payouts ", "POST /v1/rooms/room_1/payouts key=pay-1 "} {
		if !strings.HasPrefix(got[i], want) {
			t.Errorf("call %d = %q, want it to start %q", i, got[i], want)
		}
	}
	details := got[0][strings.Index(got[0], " {"):]
	for _, key := range []string{`"asset":"EUR"`, `"holder":"Ada Ltd"`, `"iban":"DE89370400440532013000"`, `"bic":"COBADEFFXXX"`} {
		if !strings.Contains(details, key) {
			t.Errorf("the details sent to Lens lack %s: %s", key, details)
		}
	}
	payout := got[3][strings.Index(got[3], " {"):]
	for _, key := range []string{`"amount_minor":9000`, `"currency":"USD"`, `"ws_a":6000`, `"ws_b":4000`} {
		if !strings.Contains(payout, key) {
			t.Errorf("the payout sent to Lens lacks %s: %s", key, payout)
		}
	}
	for call, keys := range map[string][]string{details: {`"status"`, `"workspace_id"`, `"partner"`}, payout: {`"agent_id"`}} {
		for _, key := range keys {
			if strings.Contains(call, key) {
				t.Errorf("a body sent to Lens carries %s, which the handler does not name: %s", key, call)
			}
		}
	}
}

// The screen's Idempotency-Key goes up with a room's payout and Lens's refusal of one without it reaches the screen,
// as does Lens's owner-only refusal, each with its status and sentence.
func TestRoomPayoutRelaysLensRefusals(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Idempotency-Key") == "" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"rooms: invalid request: a payout carries an Idempotency-Key of up to 128 characters"}`))
			return
		}
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"only the room's owner pays out its earnings"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/rooms/room_1/payouts", `{"amount_minor":9000,"currency":"USD"}`); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Idempotency-Key") {
		t.Fatalf("a payout with no Idempotency-Key = %d %s, want Lens's 400 and its sentence", rec.Code, rec.Body.String())
	}
	pay := httptest.NewRequest(http.MethodPost, "/api/rooms/room_1/payouts", strings.NewReader(`{"amount_minor":9000,"currency":"USD"}`))
	pay.Header.Set("Content-Type", "application/json")
	pay.Header.Set("Idempotency-Key", "pay-2")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, pay)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "only the room's owner pays out its earnings") {
		t.Fatalf("a member's payout = %d %s, want Lens's 403 and its sentence", rec.Code, rec.Body.String())
	}
}

// Bank details never reach the log, even when Lens cannot be reached to save them.
func TestPayoutDetailsNeverLogged(t *testing.T) {
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev) })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		panic(http.ErrAbortHandler) // Lens hangs up
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPut, "/api/money/payout-details", `{"asset":"EUR","holder":"Ada Ltd","iban":"DE89370400440532013000","bic":"COBADEFFXXX"}`); rec.Code != http.StatusBadGateway {
		t.Fatalf("save details with Lens gone = %d %s, want 502", rec.Code, rec.Body.String())
	}
	for _, secret := range []string{"DE89370400440532013000", "COBADEFFXXX", "Ada Ltd"} {
		if strings.Contains(buf.String(), secret) {
			t.Errorf("the log carries %q:\n%s", secret, buf.String())
		}
	}
}
