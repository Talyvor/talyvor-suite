package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B55.16 — Approvals and devices lists every passkey and phone key by name and removes a passkey, each relayed to Lens
// (B55.15) on the session's own token; the last key Lens refuses to remove comes back in Lens's words.
func TestApprovalKeysListAndPasskeyRemoveRelayToLens(t *testing.T) {
	var mu sync.Mutex
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		got = append(got, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/agents/keys"):
			_, _ = w.Write([]byte(`{"keys":[{"kind":"passkey","id":"cred_1","name":"This Mac","platform":"","created_at":"2026-11-01T09:00:00Z"},` +
				`{"kind":"phone","id":"dk_1","name":"Work iPhone","platform":"ios","created_at":"2026-11-02T09:00:00Z"}]}`))
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/agents/passkeys/cred_1"):
			_, _ = w.Write([]byte(`{"credential_id":"cred_1","removed":true}`))
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/agents/passkeys/cred_2"):
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"This is your last key. With none, nobody could approve, so add another first."}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodGet, "/api/agents/keys", ``); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), `"name":"This Mac"`) || !strings.Contains(rec.Body.String(), `"name":"Work iPhone"`) {
		t.Fatalf("keys = %d %s, want both keys by name", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodDelete, "/api/agents/passkeys", `{"credential_id":"cred_1"}`); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), `"removed":true`) {
		t.Fatalf("remove = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodDelete, "/api/agents/passkeys", `{"credential_id":"cred_2"}`); rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), "This is your last key.") {
		t.Fatalf("removing the last key = %d %s, want 409 in Lens's words", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodDelete, "/api/agents/passkeys", `{"credential_id":"../keys"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("a credential id with a path in it = %d, want 400 before Lens", rec.Code)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 3 {
		t.Fatalf("Lens received %d requests, want 3: %q", len(got), got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(got[0])[1], "/v1/workspaces/"), "/")[0]
	want := []string{
		"GET /v1/workspaces/" + ws + "/agents/keys",
		"DELETE /v1/workspaces/" + ws + "/agents/passkeys/cred_1",
		"DELETE /v1/workspaces/" + ws + "/agents/passkeys/cred_2",
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("Lens's request %d was %q, want %q", i+1, got[i], want[i])
		}
	}
}
