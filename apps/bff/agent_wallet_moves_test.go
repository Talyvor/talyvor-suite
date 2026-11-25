package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B48.47 — a top-up's quote, its challenge and confirm, the moves, the activity, a month's statement (as JSON and as a
// PDF that comes down as the file) and the requests to be paid reach Lens's routes under the session's token, with
// only the fields and query keys the screen names; a request goes up under the browser's Idempotency-Key.
func TestAgentWalletMovesReachLensAsNamed(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.RequestURI()+" key="+r.Header.Get("Idempotency-Key")+" auth="+r.Header.Get("Authorization")+" "+string(raw))
		mu.Unlock()
		if r.URL.Query().Get("format") == "pdf" {
			w.Header().Set("Content-Type", "application/pdf")
			_, _ = w.Write([]byte("%PDF-1.4 statement"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"wm_1","status":"quoted"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	for _, c := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/agents/agt_remy/wallet-moves/quote", `{"route":"cash_out","amount_minor":2500000,"currency":"USDC","payee_id":"pye_1","to_currency":"GBP","by":"x"}`},
		{http.MethodPost, "/api/agents/agt_remy/wallet-moves/wm_1/challenge", `{"anything":1}`},
		{http.MethodPost, "/api/agents/agt_remy/wallet-moves/wm_1/confirm", `{"assertion":{"credential_id":"c1"},"by":"x"}`},
		{http.MethodPost, "/api/agents/agt_remy/wallet-moves/wm_1/confirm", ``},
		{http.MethodGet, "/api/agents/agt_remy/wallet-moves", ``},
		{http.MethodGet, "/api/agents/agt_remy/wallet/activity?limit=50&all=1", ``},
		{http.MethodGet, "/api/agents/agt_remy/wallet/statement?month=2026-11&format=json&agent=other", ``},
		{http.MethodGet, "/api/agents/agt_remy/crypto-requests", ``},
	} {
		if rec := doJSON(a, c.method, c.path, c.body); rec.Code != http.StatusOK {
			t.Fatalf("%s %s = %d %s", c.method, c.path, rec.Code, rec.Body.String())
		}
	}
	pdf := httptest.NewRecorder()
	a.ServeHTTP(pdf, httptest.NewRequest(http.MethodGet, "/api/agents/agt_remy/wallet/statement?month=2026-11&format=pdf", nil))
	if pdf.Code != http.StatusOK || pdf.Header().Get("Content-Type") != "application/pdf" || !strings.HasPrefix(pdf.Body.String(), "%PDF") {
		t.Fatalf("the PDF statement came down as %d %q %q", pdf.Code, pdf.Header().Get("Content-Type"), pdf.Body.String())
	}
	ask := httptest.NewRequest(http.MethodPost, "/api/agents/agt_remy/crypto-requests",
		strings.NewReader(`{"token":"USDC","network":"base","amount_minor":5000000,"memo":"May's report","expires_at":"2026-12-01T00:00:00Z","payer_address":"0xabc"}`))
	ask.Header.Set("Content-Type", "application/json")
	ask.Header.Set("Idempotency-Key", "req-1")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, ask)
	if rec.Code != http.StatusOK {
		t.Fatalf("request = %d %s", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	want := []string{
		"POST /wallet-moves/quote key= ",
		"POST /wallet-moves/wm_1/challenge key= ",
		"POST /wallet-moves/wm_1/confirm key= ",
		"POST /wallet-moves/wm_1/confirm key= ",
		"GET /wallet-moves key= ",
		"GET /wallet/activity?limit=50 key= ",
		"GET /wallet/statement?format=json&month=2026-11 key= ",
		"GET /crypto-requests key= ",
		"GET /wallet/statement?format=pdf&month=2026-11 key= ",
		"POST /crypto-requests key=req-1 ",
	}
	if len(got) != len(want) {
		t.Fatalf("Lens saw %d calls, want %d:\n  %s", len(got), len(want), strings.Join(got, "\n  "))
	}
	for i, call := range got {
		method, rest, _ := strings.Cut(want[i], " ")
		path, key, _ := strings.Cut(rest, " ")
		if !strings.HasPrefix(call, method+" /v1/workspaces/") || !strings.Contains(call, "/agents/agt_remy"+path+" "+key) {
			t.Errorf("call %d = %s, want %s", i, call, want[i])
		}
		if !strings.Contains(call, " auth=Bearer ") || strings.Contains(call, "auth=Bearer  ") {
			t.Errorf("call %d did not go up under the session's token: %s", i, call)
		}
		if strings.Contains(call, `"by"`) || strings.Contains(call, "payer_address") {
			t.Errorf("call %d carries a field the handler does not name: %s", i, call)
		}
	}
	for _, field := range []string{`"route":"cash_out"`, `"amount_minor":2500000`, `"currency":"USDC"`, `"payee_id":"pye_1"`, `"to_currency":"GBP"`} {
		if !strings.Contains(got[0], field) {
			t.Errorf("the quote lacks %s: %s", field, got[0])
		}
	}
	if !strings.HasSuffix(got[2], `{"assertion":{"credential_id":"c1"}}`) {
		t.Errorf("the signed confirm went up as %s", got[2])
	}
	for _, i := range []int{1, 3} {
		if strings.Contains(got[i], "{") {
			t.Errorf("call %d carried a body Lens would read: %s", i, got[i])
		}
	}
	for _, field := range []string{`"token":"USDC"`, `"network":"base"`, `"amount_minor":5000000`, `"memo":"May's report"`, `"expires_at":"2026-12-01T00:00:00Z"`} {
		if !strings.Contains(got[9], field) {
			t.Errorf("the request lacks %s: %s", field, got[9])
		}
	}
}

// B48.19 — every wallet's month in one download: the owner's statement reaches Lens's workspace route under the session's
// token with only month and format, and its CSV and PDF come down as the file.
func TestOwnerWalletStatementReachesLensAsNamed(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.RequestURI()+" auth="+r.Header.Get("Authorization"))
		mu.Unlock()
		switch r.URL.Query().Get("format") {
		case "pdf":
			w.Header().Set("Content-Type", "application/pdf")
			_, _ = w.Write([]byte("%PDF-1.4 statement"))
		case "csv":
			w.Header().Set("Content-Type", "text/csv")
			_, _ = w.Write([]byte("date,wallet,amount\n"))
		default:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"accounts":[],"lines":[]}`))
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	for _, c := range []struct{ query, contentType, prefix string }{
		{"month=2026-11&format=csv&agent=agt_other", "text/csv; charset=utf-8", "date,wallet"},
		{"month=2026-10&format=pdf", "application/pdf", "%PDF"},
	} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/wallet/statement?"+c.query, nil))
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != c.contentType || !strings.HasPrefix(rec.Body.String(), c.prefix) {
			t.Fatalf("GET /api/wallet/statement?%s = %d %q %q", c.query, rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
		}
	}
	if rec := doJSON(a, http.MethodPost, "/api/wallet/statement", `{}`); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/wallet/statement = %d, want 405", rec.Code)
	}

	mu.Lock()
	defer mu.Unlock()
	want := []string{"/wallet/statement?format=csv&month=2026-11", "/wallet/statement?format=pdf&month=2026-10"}
	if len(got) != len(want) {
		t.Fatalf("Lens saw %d calls, want %d:\n  %s", len(got), len(want), strings.Join(got, "\n  "))
	}
	for i, call := range got {
		ws, rest, _ := strings.Cut(strings.TrimPrefix(call, "GET /v1/workspaces/"), "/")
		if !strings.HasPrefix(call, "GET /v1/workspaces/") || ws == "" || !strings.HasPrefix("/"+rest, want[i]+" ") {
			t.Errorf("call %d = %s, want GET /v1/workspaces/<ws>%s", i, call, want[i])
		}
		if !strings.Contains(call, " auth=Bearer ") || strings.HasSuffix(call, "auth=Bearer ") {
			t.Errorf("call %d did not go up under the session's token: %s", i, call)
		}
	}
}
