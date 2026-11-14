package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeLensPlan answers GET /v1/workspaces/{ws}/plan the way Lens's newWorkspacePlanHandler does, for the dev session's
// own workspace and its own token only; any other workspace or credential gets Lens's 404.
func fakeLensPlan(t *testing.T, body string, paths *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		*paths = append(*paths, r.Method+" "+r.URL.RequestURI())
		if r.URL.Path != "/v1/workspaces/"+own+"/plan" || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
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

// B57.18 — Home's "3 of 3 on Free": the session's own workspace's plan, the agents its plan allows (-1 is unlimited)
// and the agents it has, as Lens answers them, whatever workspace the request names.
func TestWorkspacePlanAnswersTheSessionsOwnPlanAndAgents(t *testing.T) {
	var paths []string
	a := fakeLensPlan(t, `{"plan":"free","gated_as":"free","byok_add_on":false,"gates":{"agents":3,"seats":1,"own_provider_keys":"none"},"own_provider_keys_allowed":false,"agents_used":3}`, &paths)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/plan?workspace_id=SOMEBODY-ELSE", nil)
	req.Header.Set("X-Talyvor-Workspace", "SOMEBODY-ELSE")
	a.ServeHTTP(rec, req)

	if want := "{\"plan\":\"free\",\"agents\":3,\"agents_used\":3}\n"; rec.Code != http.StatusOK || rec.Body.String() != want {
		t.Fatalf("GET /api/plan = %d %q, want 200 %q", rec.Code, rec.Body.String(), want)
	}
	if want := "GET /v1/workspaces/" + deriveWorkspaceIDLikeLens(devIdentity) + "/plan"; len(paths) != 1 || paths[0] != want {
		t.Errorf("Lens was asked %v, want only %q", paths, want)
	}
}

// An answer with no plan, or counts that are not counts, is a failed read: Home never draws a guessed plan line.
func TestWorkspacePlanRefusesAnUnreadableAnswer(t *testing.T) {
	for _, body := range []string{`not json`, `{"gates":{"agents":3},"agents_used":1}`, `{"plan":"team","gates":{"agents":-2},"agents_used":1}`, `{"plan":"team","gates":{"agents":25},"agents_used":-1}`} {
		var paths []string
		if rec := doJSON(fakeLensPlan(t, body, &paths), http.MethodGet, "/api/plan", ""); rec.Code != http.StatusBadGateway {
			t.Errorf("Lens answered %s: BFF = %d %s, want 502", body, rec.Code, rec.Body.String())
		}
	}
	var paths []string
	if rec := doJSON(fakeLensPlan(t, `{}`, &paths), http.MethodPost, "/api/plan", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/plan = %d, want 405", rec.Code)
	}
}
