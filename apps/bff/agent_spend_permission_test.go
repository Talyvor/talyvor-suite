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

// B48.48 — an agent's limits reach Lens's spend-permission routes under the session's token: the permission read, a
// changed one prepared with only the fields Lens's Permission names, and the canonical JSON kept with the passkey's
// assertion exactly as the browser made them.
func TestAgentSpendPermissionReachesLensAsNamed(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.RequestURI()+" auth="+r.Header.Get("Authorization")+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"canonical":"{}","challenge":"c"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	canonical := `{"version":"talyvor.spend_permission.v1","agent_id":"agt_remy","number":2,"permission":{"tokens":[]}}`
	for _, c := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/agents/agt_remy/spend-permission?agent=other", ``},
		{http.MethodPost, "/api/agents/agt_remy/spend-permission/prepare",
			`{"tokens":[{"token":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","allowance":50000000,"period":"week","per_payment":10000000,"by":"x"}],"allowed":["0x1"],"blocked":["0x2"],"expires":"2027-01-01T00:00:00Z","frozen":true}`},
		{http.MethodPost, "/api/agents/agt_remy/spend-permission/prepare", `{"tokens":[],"expires":"2027-01-01T00:00:00Z"}`},
		{http.MethodPut, "/api/agents/agt_remy/spend-permission", `{"canonical":` + jsonQuote(canonical) + `,"assertion":{"credential_id":"c1","signature":"s"},"by":"x"}`},
	} {
		if rec := doJSON(a, c.method, c.path, c.body); rec.Code != http.StatusOK {
			t.Fatalf("%s %s = %d %s", c.method, c.path, rec.Code, rec.Body.String())
		}
	}
	if rec := doJSON(a, http.MethodPut, "/api/agents/agt_remy/spend-permission", `{"assertion":{}}`); rec.Code != http.StatusBadRequest {
		t.Errorf("a PUT with no canonical JSON = %d, want 400 before Lens", rec.Code)
	}

	mu.Lock()
	defer mu.Unlock()
	want := []string{"GET /spend-permission ", "POST /spend-permission/prepare ", "POST /spend-permission/prepare ", "PUT /spend-permission "}
	if len(got) != len(want) {
		t.Fatalf("Lens saw %d calls, want %d:\n  %s", len(got), len(want), strings.Join(got, "\n  "))
	}
	for i, call := range got {
		method, path, _ := strings.Cut(strings.TrimSpace(want[i]), " ")
		if !strings.HasPrefix(call, method+" /v1/workspaces/") || !strings.Contains(call, "/agents/agt_remy"+path+" ") {
			t.Errorf("call %d = %s, want %s", i, call, want[i])
		}
		if !strings.Contains(call, " auth=Bearer ") || strings.Contains(call, "auth=Bearer  ") {
			t.Errorf("call %d did not go up under the session's token: %s", i, call)
		}
		if strings.Contains(call, `"by"`) || strings.Contains(call, `"frozen"`) || strings.Contains(call, "agent=other") {
			t.Errorf("call %d carries what the handler does not name: %s", i, call)
		}
	}
	for _, field := range []string{`"token":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"`, `"allowance":50000000`, `"period":"week"`, `"per_payment":10000000`,
		`"allowed":["0x1"]`, `"blocked":["0x2"]`, `"expires":"2027-01-01T00:00:00Z"`} {
		if !strings.Contains(got[1], field) {
			t.Errorf("the prepare lacks %s: %s", field, got[1])
		}
	}
	if !strings.Contains(got[2], `"tokens":[]`) {
		t.Errorf("a freeze's permission went up without its empty tokens: %s", got[2])
	}
	if !strings.HasSuffix(got[3], `{"canonical":`+jsonQuote(canonical)+`,"assertion":{"credential_id":"c1","signature":"s"}}`) {
		t.Errorf("the signed permission went up as %s", got[2])
	}
}

func jsonQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
