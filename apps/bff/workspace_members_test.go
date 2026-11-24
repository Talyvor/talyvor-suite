package main

// workspace_members_test.go — B52.36: the owner's invite links and members relay on the session's own token, and an
// accept reaches Lens on the provision secret with the SESSION's identity and the token, never one the browser sent.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// inviteLens answers B52.35's routes and hands every other request to the stranger Lens behind it.
type inviteLens struct {
	mu       sync.Mutex
	accepts  []map[string]string // each accept body, as Lens received it
	previews []map[string]string // each preview body, as Lens received it (B52.46)
	secrets  []string            // the provision secret header each accept carried
	auths    []string            // the bearer each owner route carried
	paths    []string            // method and path of each owner route
}

func startMemberSuite(t *testing.T) (*strangerSuite, *inviteLens) {
	t.Helper()
	ml := &inviteLens{}
	var behind *httputil.ReverseProxy
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/provision/invites/preview":
			var in map[string]string
			_ = json.NewDecoder(r.Body).Decode(&in)
			ml.mu.Lock()
			ml.previews = append(ml.previews, in)
			ml.secrets = append(ml.secrets, r.Header.Get(provisionSecretHeader))
			ml.mu.Unlock()
			if in["token"] != "wsinvtok_good" {
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, `{"error":"not found: no such invite"}`)
				return
			}
			_, _ = io.WriteString(w, `{"workspace_id":"ws_owner","name":"Northwind Studio"}`)
		case r.URL.Path == "/v1/provision/invites/accept":
			var in map[string]string
			_ = json.NewDecoder(r.Body).Decode(&in)
			ml.mu.Lock()
			ml.accepts = append(ml.accepts, in)
			ml.secrets = append(ml.secrets, r.Header.Get(provisionSecretHeader))
			ml.mu.Unlock()
			if in["token"] != "wsinvtok_good" {
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, `{"error":"not found: no such invite"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"member": map[string]string{"id": "wsm_1", "workspace_id": "ws_owner",
				"identity": in["identity"], "role": "member"}, "created": true})
		case r.URL.Path == "/v1/provision/workspaces":
			_, _ = io.WriteString(w, `{"workspaces":[{"id":"ws_own","name":"Mine","role":"owner"},{"id":"ws_owner","name":"Northwind Studio","role":"member"}]}`)
		case strings.Contains(r.URL.Path, "/member-invites") || strings.HasSuffix(r.URL.Path, "/members") || strings.Contains(r.URL.Path, "/members/"):
			ml.mu.Lock()
			ml.auths = append(ml.auths, r.Header.Get("Authorization"))
			ml.paths = append(ml.paths, r.Method+" "+r.URL.Path)
			ml.mu.Unlock()
			switch {
			case r.Method == http.MethodPost:
				w.WriteHeader(http.StatusCreated)
				_, _ = io.WriteString(w, `{"id":"wsinv_1","token":"wsinvtok_good","max_uses":1,"uses":0,"live":true}`)
			case strings.HasSuffix(r.URL.Path, "/members") && r.Method == http.MethodGet:
				_, _ = io.WriteString(w, `{"members":[{"id":"wsm_1","workspace_id":"ws","identity":"iss\u0000bo","role":"member","added_at":"2026-11-20T10:00:00Z"}]}`)
			case r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/members/"):
				w.WriteHeader(http.StatusNoContent)
			default:
				_, _ = io.WriteString(w, `{"invites":[]}`)
			}
		default:
			behind.ServeHTTP(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	s := startStrangerSuiteWith(t, []string{"*"}, func(c *config) {
		u, _ := url.Parse(c.lensBaseURL)
		behind = httputil.NewSingleHostReverseProxy(u)
		c.lensBaseURL = srv.URL
	})
	return s, ml
}

func TestB5236_AcceptSendsTheSessionsIdentityAndTheToken(t *testing.T) {
	s, ml := startMemberSuite(t)
	br := s.signUp("b5236-bo", "bo@example.org")

	// The browser names an identity of its own: it is not the one Lens is given.
	code, body := s.post(br, "/api/invites/accept", `{"token":"wsinvtok_good","identity":"someone-else"}`)
	if code != http.StatusOK {
		t.Fatalf("accept: %d %s, want 200", code, body)
	}
	var got struct {
		WorkspaceID string `json:"workspace_id"`
		Name        string `json:"name"`
		Created     bool   `json:"created"`
	}
	if err := json.Unmarshal([]byte(body), &got); err != nil || got.WorkspaceID != "ws_owner" || got.Name != "Northwind Studio" || !got.Created {
		t.Fatalf("accept answered %s, want the joined workspace named Northwind Studio", body)
	}
	ml.mu.Lock()
	defer ml.mu.Unlock()
	want := provisionIdentity(testIssuer, "b5236-bo")
	if len(ml.accepts) != 1 || ml.accepts[0]["identity"] != want || ml.accepts[0]["token"] != "wsinvtok_good" || len(ml.accepts[0]) != 2 {
		t.Fatalf("Lens received %q, want only the session's identity %q and the token", ml.accepts, want)
	}
	if ml.secrets[0] != testProvisionSecret {
		t.Fatalf("the accept carried %q, want the provision secret", ml.secrets[0])
	}
}

func TestB5236_AcceptOfADeadInviteSaysSo(t *testing.T) {
	s, _ := startMemberSuite(t)
	br := s.signUp("b5236-cy", "cy@example.org")
	code, body := s.post(br, "/api/invites/accept", `{"token":"wsinvtok_revoked"}`)
	if code != http.StatusNotFound || !strings.Contains(body, "Ask for a new one") {
		t.Fatalf("a dead invite answered %d %s, want 404 in words", code, body)
	}
}

func TestB5236_AcceptNeedsASession(t *testing.T) {
	s, ml := startMemberSuite(t)
	code, _ := s.post(s.browser(), "/api/invites/accept", `{"token":"wsinvtok_good"}`)
	if code != http.StatusUnauthorized || len(ml.accepts) != 0 {
		t.Fatalf("an accept with no session answered %d and reached Lens %d times, want 401 and never", code, len(ml.accepts))
	}
}

// B52.46: the Join page names the workspace before the press. The preview reaches Lens on the provision secret with the
// session's identity and the token only, and joins nobody.
func TestB5246_PreviewSendsTheSessionsIdentityAndTheTokenOnly(t *testing.T) {
	s, ml := startMemberSuite(t)
	br := s.signUp("b5246-di", "di@example.org")

	code, body := s.post(br, "/api/invites/preview", `{"token":"wsinvtok_good","identity":"someone-else"}`)
	if code != http.StatusOK || body == "" {
		t.Fatalf("preview: %d %s, want 200", code, body)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(body), &got); err != nil || got["workspace_id"] != "ws_owner" || got["name"] != "Northwind Studio" || len(got) != 2 {
		t.Fatalf("preview answered %s, want only the workspace Northwind Studio", body)
	}
	code, body = s.post(br, "/api/invites/preview", `{"token":"wsinvtok_revoked"}`)
	if code != http.StatusNotFound || !strings.Contains(body, "Ask for a new one") {
		t.Fatalf("a dead invite's preview answered %d %s, want 404 in words", code, body)
	}
	if code, _ := s.post(s.browser(), "/api/invites/preview", `{"token":"wsinvtok_good"}`); code != http.StatusUnauthorized {
		t.Fatalf("a preview with no session answered %d, want 401", code)
	}
	ml.mu.Lock()
	defer ml.mu.Unlock()
	want := provisionIdentity(testIssuer, "b5246-di")
	if len(ml.previews) != 2 || ml.previews[0]["identity"] != want || ml.previews[0]["token"] != "wsinvtok_good" || len(ml.previews[0]) != 2 {
		t.Fatalf("Lens received %q, want only the session's identity %q and the token", ml.previews, want)
	}
	if ml.secrets[0] != testProvisionSecret {
		t.Fatalf("the preview carried %q, want the provision secret", ml.secrets[0])
	}
	if len(ml.accepts) != 0 {
		t.Fatalf("a preview reached Lens's accept %d times, want never", len(ml.accepts))
	}
}

func TestB5236_OwnerRoutesRideTheSessionsTokenAndHideIdentities(t *testing.T) {
	s, ml := startMemberSuite(t)
	br := s.signUp("b5236-ada", "ada@example.org")
	ws := deriveWorkspaceIDLikeLens(provisionIdentity(testIssuer, "b5236-ada"))

	code, body := s.post(br, "/api/workspace/member-invites", `{"max_uses":1,"expires_at":"2099-01-01T00:00:00Z"}`)
	if code != http.StatusCreated || !strings.Contains(body, `"token":"wsinvtok_good"`) {
		t.Fatalf("make an invite: %d %s", code, body)
	}
	resp, body := doReq(t, br, http.MethodGet, s.ts.URL+"/api/workspace/members")
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, `"id":"wsm_1"`) || strings.Contains(body, "identity") || strings.Contains(body, "bo") {
		t.Fatalf("members: %d %s, want the member without their identity", resp.StatusCode, body)
	}
	req, _ := http.NewRequest(http.MethodDelete, s.ts.URL+"/api/workspace/members/wsm_1", nil)
	req.Header.Set("Origin", s.app.cfg.publicBaseURL)
	del, err := br.Do(req)
	if err != nil || del.StatusCode != http.StatusNoContent {
		t.Fatalf("remove a member: %v %v", err, del)
	}
	_ = del.Body.Close()

	ml.mu.Lock()
	defer ml.mu.Unlock()
	wantPaths := []string{"POST /v1/workspaces/" + ws + "/member-invites", "GET /v1/workspaces/" + ws + "/members", "DELETE /v1/workspaces/" + ws + "/members/wsm_1"}
	if strings.Join(ml.paths, "|") != strings.Join(wantPaths, "|") {
		t.Fatalf("Lens was asked %q, want %q", ml.paths, wantPaths)
	}
	for _, a := range ml.auths {
		if a != "Bearer jwt-for-"+ws {
			t.Fatalf("an owner route carried %q, want the session's own token", a)
		}
	}
}
