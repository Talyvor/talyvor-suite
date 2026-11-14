package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B59.19 — the quote and the send reach Lens under the session's token, at the session's workspace, with only the fields
// the screen names; the send carries the browser's Idempotency-Key and never names funding; the receipt is read back.
func TestInstantTransferReachesLensAsNamed(t *testing.T) {
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
		_, _ = w.Write([]byte(`{"id":"itr_1","status":"received"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/instant-transfers/quote", `{"send_minor":500000,"send_currency":"USD","receive_currency":"EUR","to":"bank_account","country":"DE","workspace_id":"other"}`); rec.Code != http.StatusOK {
		t.Fatalf("quote = %d %s", rec.Code, rec.Body.String())
	}
	send := httptest.NewRequest(http.MethodPost, "/api/agents/agt_remy/instant-transfers", strings.NewReader(`{"quote_id":"itq_1","to_payee_id":"payee_lf","funding":"live","idempotency_key":"body-key"}`))
	send.Header.Set("Content-Type", "application/json")
	send.Header.Set("Idempotency-Key", "move-1")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, send)
	if rec.Code != http.StatusOK {
		t.Fatalf("send = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/instant-transfers/itr_1", ``); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"received"`) {
		t.Fatalf("receipt = %d %s", rec.Code, rec.Body.String())
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
	quote, sent, receipt := got[0], got[1], got[2]
	if !strings.HasPrefix(quote, "POST /v1/workspaces/") || !strings.Contains(quote, "/money/instant-transfers/quote ") || strings.Contains(quote, "other") {
		t.Errorf("the quote went to %s", quote)
	}
	for _, key := range []string{`"send_minor":500000`, `"send_currency":"USD"`, `"receive_currency":"EUR"`, `"to":"bank_account"`, `"country":"DE"`} {
		if !strings.Contains(quote, key) {
			t.Errorf("the quote sent to Lens lacks %s: %s", key, quote)
		}
	}
	if !strings.Contains(sent, "/agents/agt_remy/money/instant-transfers key=move-1 ") {
		t.Errorf("the send did not reach the agent's route under the browser's key: %s", sent)
	}
	for _, key := range []string{`"quote_id":"itq_1"`, `"to_payee_id":"payee_lf"`} {
		if !strings.Contains(sent, key) {
			t.Errorf("the send lacks %s: %s", key, sent)
		}
	}
	for _, key := range []string{`"funding"`, `"idempotency_key"`, `"to_account_id"`} {
		if strings.Contains(sent, key) {
			t.Errorf("the send carries %s, which the handler does not name: %s", key, sent)
		}
	}
	if !strings.HasPrefix(receipt, "GET /v1/workspaces/") || !strings.Contains(receipt, "/money/instant-transfers/itr_1 ") {
		t.Errorf("the receipt was read from %s", receipt)
	}
}

// B59.19 — an agent without "Can use Instant transfer" is refused with a field, and the screen picks its words from it:
// the field and the code reach the browser beside the sentence.
func TestInstantTransferRefusalKeepsItsField(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"This agent's rules do not let it use Instant transfer (may_instant_transfer)","code":"agent_rule","field":"may_instant_transfer","secret":"x"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodPost, "/api/agents/agt_remy/instant-transfers", `{"quote_id":"itq_1","to_account_id":"macc_2"}`)
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("refusal body: %v (%s)", err, rec.Body.String())
	}
	if rec.Code != http.StatusForbidden || body["field"] != "may_instant_transfer" || body["code"] != "agent_rule" || body["error"] == "" {
		t.Fatalf("refusal = %d %v, want 403 with its sentence, code and field", rec.Code, body)
	}
	if _, ok := body["secret"]; ok {
		t.Errorf("the refusal relayed a field the handler does not name: %v", body)
	}
}
