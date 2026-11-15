package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeLensCardSpends answers GET /v1/money/card-spends as Lens does: the caller's own workspace's spends, by its token,
// for the agent named — another workspace's agent is an empty list.
func fakeLensCardSpends(t *testing.T, got *[]string) *app {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		*got = append(*got, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/money/card-spends" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer jwt-for-") {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		if r.URL.Query().Get("agent_id") != "agt_1" {
			_, _ = w.Write([]byte(`{"card_spends":[]}`))
			return
		}
		_, _ = w.Write([]byte(`{"card_spends":[{"id":"csp_1","agent_id":"agt_1","standing_card_id":"rcard_1","amount_minor":5000,"currency":"GBP","status":"issued","expires_at":"2026-11-15T10:00:00Z"},{"id":"csp_2","agent_id":"agt_1","standing_card_id":"","amount_minor":1299,"currency":"GBP","status":"issued","card":{"id":"mcard_1","last4":"4242"}}]}`))
	}))
	t.Cleanup(srv.Close)
	return newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)
}

// B59.54 — an agent's one-time and standing cards: GET /api/money/card-spends?agent_id= reaches Lens on the session's own
// token with the agent only, and answers Lens's list unchanged; another workspace's agent is Lens's empty list.
func TestCardSpendsRelayTheAgentsListFromLens(t *testing.T) {
	var got []string
	a := fakeLensCardSpends(t, &got)
	rec := doJSON(a, http.MethodGet, "/api/money/card-spends?agent_id=agt_1&workspace_id=ws_other", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/money/card-spends = %d %s", rec.Code, rec.Body.String())
	}
	for _, want := range []string{`"standing_card_id":"rcard_1"`, `"expires_at":"2026-11-15T10:00:00Z"`, `"standing_card_id":""`, `"card":{"id":"mcard_1","last4":"4242"}`, `"amount_minor":1299`} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Errorf("body = %s; want Lens's %s", rec.Body.String(), want)
		}
	}
	if len(got) != 1 || !strings.HasPrefix(got[0], "GET /v1/money/card-spends?agent_id=agt_1 Bearer jwt-for-") {
		t.Fatalf("Lens got %q; want GET /v1/money/card-spends?agent_id=agt_1 on the session's token, and no workspace_id", got)
	}

	rec = doJSON(a, http.MethodGet, "/api/money/card-spends?agent_id=agt_other_workspace", "")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"card_spends":[]}` {
		t.Fatalf("another workspace's agent = %d %s; want Lens's empty list", rec.Code, rec.Body.String())
	}

	if rec := doJSON(a, http.MethodPost, "/api/money/card-spends", `{"agent_id":"agt_1","amount_minor":5000,"currency":"GBP"}`); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/money/card-spends = %d; want 405: an agent asks for a card spend itself, not the owner's app", rec.Code)
	}
	if len(got) != 2 {
		t.Fatalf("Lens got %q; want only the two reads", got)
	}
}
