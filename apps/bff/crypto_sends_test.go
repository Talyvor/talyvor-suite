package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B48.36 — the quote, the send, the list and the owner's answers reach Lens's crypto-sends routes under the
// session's token, with only the fields the screen names; a send goes up under the browser's Idempotency-Key; an
// approve with no test amount sends no body, which Lens reads as "send it all".
func TestCryptoSendsReachLensAsNamed(t *testing.T) {
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
		_, _ = w.Write([]byte(`{"id":"cs_1","status":"awaiting_owner"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	body := `{"to":"0x00000000000000000000000000000000000000a1","network":"base","token":"USDC","amount_minor":2500000,"by":"agent:x"}`
	if rec := doJSON(a, http.MethodPost, "/api/agents/agt_remy/crypto-sends/quote", body); rec.Code != http.StatusOK {
		t.Fatalf("quote = %d %s", rec.Code, rec.Body.String())
	}
	send := httptest.NewRequest(http.MethodPost, "/api/agents/agt_remy/crypto-sends", strings.NewReader(body))
	send.Header.Set("Content-Type", "application/json")
	send.Header.Set("Idempotency-Key", "send-1")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, send)
	if rec.Code != http.StatusOK {
		t.Fatalf("send = %d %s", rec.Code, rec.Body.String())
	}
	for _, c := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/agents/agt_remy/crypto-sends", ``},
		{http.MethodPost, "/api/agents/agt_remy/crypto-sends/cs_1/approve", `{"test_amount_minor":100000}`},
		{http.MethodPost, "/api/agents/agt_remy/crypto-sends/cs_1/approve", ``},
		{http.MethodPost, "/api/agents/agt_remy/crypto-sends/cs_1/decline", `{"anything":1}`},
		{http.MethodGet, "/api/agents/agt_remy/smart-account", ``},
	} {
		if rec := doJSON(a, c.method, c.path, c.body); rec.Code != http.StatusOK {
			t.Fatalf("%s %s = %d %s", c.method, c.path, rec.Code, rec.Body.String())
		}
	}

	mu.Lock()
	defer mu.Unlock()
	want := []string{
		"POST /crypto-sends/quote key= ",
		"POST /crypto-sends key=send-1 ",
		"GET /crypto-sends key= ",
		"POST /crypto-sends/cs_1/approve key= ",
		"POST /crypto-sends/cs_1/approve key= ",
		"POST /crypto-sends/cs_1/decline key= ",
		"GET /smart-account key= ",
	}
	if len(got) != len(want) {
		t.Fatalf("Lens saw %d calls, want %d:\n  %s", len(got), len(want), strings.Join(got, "\n  "))
	}
	for i, call := range got {
		method, rest, _ := strings.Cut(want[i], " ")
		if !strings.HasPrefix(call, method+" /v1/workspaces/") || !strings.Contains(call, "/agents/agt_remy"+rest) {
			t.Errorf("call %d = %s, want %s", i, call, want[i])
		}
		if !strings.Contains(call, " auth=Bearer ") || strings.Contains(call, "auth=Bearer  ") {
			t.Errorf("call %d did not go up under the session's token: %s", i, call)
		}
	}
	for _, i := range []int{0, 1} {
		for _, key := range []string{`"to":"0x00000000000000000000000000000000000000a1"`, `"network":"base"`, `"token":"USDC"`, `"amount_minor":2500000`} {
			if !strings.Contains(got[i], key) {
				t.Errorf("call %d lacks %s: %s", i, key, got[i])
			}
		}
		if strings.Contains(got[i], `"by"`) {
			t.Errorf("call %d carries a field the handler does not name: %s", i, got[i])
		}
	}
	if !strings.HasSuffix(got[3], `{"test_amount_minor":100000}`) {
		t.Errorf("the test-amount approve went up as %s", got[3])
	}
	for _, i := range []int{4, 5} {
		if strings.Contains(got[i], "{") {
			t.Errorf("call %d carried a body Lens would read: %s", i, got[i])
		}
	}
}
