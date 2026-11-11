package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeLensAccount answers GET /v1/workspaces/{ws}/account the way Lens B59.6 does, for the dev session's own workspace
// and its own token only; any other workspace or credential gets Lens's 404. It records every path the BFF asks for.
func fakeLensAccount(t *testing.T, body string, paths *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		*paths = append(*paths, r.Method+" "+r.URL.RequestURI())
		if r.URL.Path != "/v1/workspaces/"+own+"/account" || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)
}

// B59.10 — the web reads its workspace's type and kind of money. It answers Lens's two words for the session's own
// workspace, whatever workspace the request names.
func TestWorkspaceAccountAnswersTheSessionsOwnTypeAndKind(t *testing.T) {
	var paths []string
	a := fakeLensAccount(t, `{"workspace_id":"ws_own","account_type":"personal","money_kind":"stablecoin"}`, &paths)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspace/account?workspace_id=SOMEBODY-ELSE", nil)
	req.Header.Set("X-Talyvor-Workspace", "SOMEBODY-ELSE")
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != "{\"account_type\":\"personal\",\"money_kind\":\"stablecoin\"}\n" {
		t.Fatalf("GET /api/workspace/account = %d %q, want 200 with Lens's type and kind", rec.Code, rec.Body.String())
	}
	want := "GET /v1/workspaces/" + deriveWorkspaceIDLikeLens(devIdentity) + "/account"
	if len(paths) != 1 || paths[0] != want {
		t.Errorf("Lens was asked %v, want only %q", paths, want)
	}
}

// A type or kind Lens does not name is a failed read, never a guess the web would draw screens by.
func TestWorkspaceAccountRefusesAnUnknownTypeOrKind(t *testing.T) {
	for _, body := range []string{`not json`, `{"account_type":"business"}`, `{"account_type":"family","money_kind":"fiat"}`, `{"account_type":"personal","money_kind":"gold"}`} {
		var paths []string
		if rec := doJSON(fakeLensAccount(t, body, &paths), http.MethodGet, "/api/workspace/account", ""); rec.Code != http.StatusBadGateway {
			t.Errorf("Lens answered %s: BFF = %d %s, want 502", body, rec.Code, rec.Body.String())
		}
	}
	var paths []string
	if rec := doJSON(fakeLensAccount(t, `{}`, &paths), http.MethodPost, "/api/workspace/account", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/workspace/account = %d, want 405", rec.Code)
	}
}
