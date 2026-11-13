package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeLensAreas answers GET /v1/workspaces/{ws}/areas the way Lens B59.1 does, for the dev session's own workspace
// and its own token only; any other workspace or credential gets Lens's 404. It records every path the BFF asks for.
func fakeLensAreas(t *testing.T, body string, paths *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		*paths = append(*paths, r.Method+" "+r.URL.RequestURI())
		if r.URL.Path != "/v1/workspaces/"+own+"/areas" || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
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

// B59.38 — the phone reads which areas its workspace has. It answers Lens's list for the session's own workspace,
// whatever workspace the request names.
func TestWorkspaceAreasAnswersLensListForTheSessionsOwnWorkspace(t *testing.T) {
	var paths []string
	a := fakeLensAreas(t, `{"areas":["chat","docs"]}`, &paths)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspace/areas?workspace_id=SOMEBODY-ELSE", nil)
	req.Header.Set("X-Talyvor-Workspace", "SOMEBODY-ELSE")
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/workspace/areas = %d %s", rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if b, _ := json.Marshal(got); string(b) != `{"areas":["chat","docs"]}` {
		t.Errorf("body = %s, want Lens's list", b)
	}
	want := "GET /v1/workspaces/" + deriveWorkspaceIDLikeLens(devIdentity) + "/areas"
	if len(paths) != 1 || paths[0] != want {
		t.Errorf("Lens was asked %v, want only %q", paths, want)
	}
}

// A default workspace has no areas: an empty list, never null, so the phone shows none.
func TestWorkspaceAreasDefaultWorkspaceIsAnEmptyList(t *testing.T) {
	var paths []string
	rec := doJSON(fakeLensAreas(t, `{"areas":[]}`, &paths), http.MethodGet, "/api/workspace/areas", "")
	if rec.Code != http.StatusOK || rec.Body.String() != "{\"areas\":[]}\n" {
		t.Fatalf("GET /api/workspace/areas = %d %q, want 200 {\"areas\":[]}", rec.Code, rec.Body.String())
	}
}

// A failed read is a failure, never an empty list the phone would take for "no areas".
func TestWorkspaceAreasForwardsLensRefusal(t *testing.T) {
	var paths []string
	a := fakeLensAreas(t, `not json`, &paths)
	if rec := doJSON(a, http.MethodGet, "/api/workspace/areas", ""); rec.Code != http.StatusBadGateway {
		t.Errorf("unreadable Lens answer = %d %s, want 502", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/workspace/areas", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST = %d, want 405", rec.Code)
	}
}
