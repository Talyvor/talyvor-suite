package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B41.7 — the one search box reaches Lens's GET /v1/money/search with only the query, and answers Lens's groups as
// written; a query Lens refuses comes back with its sentence.
func TestMoneySearchReachesLensWithOnlyTheQuery(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		got = append(got, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
		w.Header().Set("Content-Type", "application/json")
		if len(r.URL.Query().Get("q")) < 2 {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"economy: search: search for 2 to 100 characters"}`))
			return
		}
		_, _ = w.Write([]byte(`{"query":"acme","groups":[{"kind":"payee","results":[{"kind":"payee","id":"pye_1","title":"Acme Hosting","detail":"GB"}]}]}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/money/search?q=Acme+%26+Co&limit=20&workspace_id=ws_other", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"title":"Acme Hosting"`) {
		t.Fatalf("search = %d %s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 || got[0] != "GET /v1/money/search?q=Acme+%26+Co" {
		t.Fatalf("Lens got %q; want only the query", got)
	}
	rec = doJSON(a, http.MethodGet, "/api/money/search?q=a", "")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "2 to 100 characters") {
		t.Fatalf("short search = %d %s", rec.Code, rec.Body.String())
	}
}
