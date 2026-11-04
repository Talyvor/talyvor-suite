package main

import (
	"io"
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

// B28.62 — the limit alerts reach Lens's GET /v1/money/budgets/alerts with nothing of the caller's query, and come back as
// Lens wrote them.
func TestMoneyBudgetAlertsReachLens(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		got = append(got, r.Method+" "+r.URL.RequestURI())
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"alerts":[{"id":"sal_1","kind":"budget","subject":"bdg_1","percent":80,"spent_minor":800,"limit_minor":1000,"currency":"GBP"}]}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/money/budgets/alerts?workspace_id=ws_other", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"percent":80`) {
		t.Fatalf("alerts = %d %s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 || got[0] != "GET /v1/money/budgets/alerts" {
		t.Fatalf("Lens got %q; want only GET /v1/money/budgets/alerts", got)
	}
	if rec = doJSON(a, http.MethodPost, "/api/money/budgets/alerts", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST = %d; want 405", rec.Code)
	}
}

// B41.20 — the subscriptions reach Lens's GET /v1/money/spending/subscriptions with nothing of the caller's query.
func TestMoneySubscriptionsReachLens(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		got = append(got, r.Method+" "+r.URL.RequestURI())
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"subscriptions":[{"merchant":"Acme Cloud","amount_minor":1200,"currency":"GBP","interval":"monthly","monthly_minor":1200}]}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/money/spending/subscriptions?workspace_id=ws_other", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"monthly_minor":1200`) {
		t.Fatalf("subscriptions = %d %s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 || got[0] != "GET /v1/money/spending/subscriptions" {
		t.Fatalf("Lens got %q; want only GET /v1/money/spending/subscriptions", got)
	}
	if rec = doJSON(a, http.MethodPost, "/api/money/spending/subscriptions", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST = %d; want 405", rec.Code)
	}
}

// B41.39 — budgets reach Lens's /v1/money/budgets with only the budget's own fields, and a budget is removed by its id.
func TestMoneyBudgetsReachLensWithOnlyTheBudget(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" "+string(b))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"budgets":[]}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	doJSON(a, http.MethodGet, "/api/money/budgets?workspace_id=ws_other", "")
	doJSON(a, http.MethodPut, "/api/money/budgets", `{"agent_id":"all","category":"ai_software","period":"month","amount_minor":10000,"currency":"GBP","timezone":"Europe/London","workspace_id":"ws_other"}`)
	doJSON(a, http.MethodDelete, "/api/money/budgets/bdg_1", "")
	want := []string{
		"GET /v1/money/budgets ",
		`PUT /v1/money/budgets {"agent_id":"all","category":"ai_software","period":"month","amount_minor":10000,"currency":"GBP","timezone":"Europe/London"}`,
		"DELETE /v1/money/budgets/bdg_1 ",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens got\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/budgets", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST = %d; want 405", rec.Code)
	}
}

// B53.8 — the Spending screen's reads and writes reach Lens with only their own fields: a period and nothing else of the
// query, a merchant's category, and the notice settings.
func TestMoneySpendingReachesLensWithOnlyItsFields(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.RequestURI()+" "+string(b))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	doJSON(a, http.MethodGet, "/api/money/spending?from=2026-11-01&to=2026-12-01&workspace_id=ws_other", "")
	doJSON(a, http.MethodGet, "/api/money/spending/unusual?from=2026-11-01", "")
	doJSON(a, http.MethodPut, "/api/money/spending/merchants", `{"merchant":"Bistro","category":"eating_out","workspace_id":"ws_other"}`)
	doJSON(a, http.MethodGet, "/api/money/coach", "")
	doJSON(a, http.MethodGet, "/api/money/notices", "")
	doJSON(a, http.MethodPut, "/api/money/notices/settings", `{"timezone":"Europe/London","quiet_from":"22:00","quiet_until":"07:00","off":["tip"],"workspace_id":"ws_other"}`)
	want := []string{
		"GET /v1/money/spending?from=2026-11-01&to=2026-12-01 ",
		"GET /v1/money/spending/unusual?from=2026-11-01 ",
		`PUT /v1/money/spending/merchants {"merchant":"Bistro","category":"eating_out"}`,
		"GET /v1/money/coach ",
		"GET /v1/money/notices ",
		`PUT /v1/money/notices/settings {"timezone":"Europe/London","quiet_from":"22:00","quiet_until":"07:00","off":["tip"]}`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens got\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/spending", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST = %d; want 405", rec.Code)
	}
}
