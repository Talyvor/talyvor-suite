package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B28.49 — a batch of single-use cards reaches Lens with the agent, the job, the currency and each card's merchant and cap
// only, under the screen's Idempotency-Key; the batches are Lens's, and the approval names the batch and nothing else.
func TestSingleUseCardsReachLensWithOnlyTheJobAndItsCards(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.RequestURI()+" key="+r.Header.Get("Idempotency-Key")+" "+string(b))
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v1/money/cards" {
			w.WriteHeader(http.StatusCreated)
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/money/cards", strings.NewReader(
		`{"agent_id":"agt_1","purpose":"Book a trip","currency":"GBP","cards":[{"merchant":"Rail Co","cap_minor":4500,"status":"active"}],"funding":"live","workspace_id":"ws_other"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "cards-1")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/money/cards = %d %s", rec.Code, rec.Body.String())
	}
	doJSON(a, http.MethodGet, "/api/money/cards?agent_id=agt_1&workspace_id=ws_other", "")
	doJSON(a, http.MethodPost, "/api/money/cards/mcb_1/approve", `{"by":"someone_else"}`)
	want := []string{
		`POST /v1/money/cards key=cards-1 {"agent_id":"agt_1","cards":[{"cap_minor":4500,"merchant":"Rail Co"}],"currency":"GBP","purpose":"Book a trip"}`,
		"GET /v1/money/cards?agent_id=agt_1 key= ",
		"POST /v1/money/cards/mcb_1/approve key= ",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens got\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}
