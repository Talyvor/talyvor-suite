package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// areasUpstream is Lens, Track and Docs on one fake server. Lens's GET /v1/workspaces/{ws}/areas
// answers whatever the test has switched on; every other path answers an empty JSON list.
type areasUpstream struct {
	srv  *httptest.Server
	mu   sync.Mutex
	on   []string
	down bool // Lens answers 503 to the areas read
}

func (u *areasUpstream) set(areas ...string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.on = areas
}

func newAreasUpstream(t *testing.T) *areasUpstream {
	t.Helper()
	u := &areasUpstream{on: []string{}}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/v1/workspaces/") && strings.HasSuffix(r.URL.Path, "/areas") {
			u.mu.Lock()
			defer u.mu.Unlock()
			if u.down {
				http.Error(w, "down", http.StatusServiceUnavailable)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string][]string{"areas": u.on})
			return
		}
		_, _ = io.WriteString(w, `[]`)
	}))
	t.Cleanup(u.srv.Close)
	return u
}

// areasApp is a signed-in BFF whose areas come from Lens, as in production.
func areasApp(t *testing.T, u *areasUpstream) (*app, *http.Cookie) {
	t.Helper()
	cfg := config{
		lensBaseURL: u.srv.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com", sessionTTL: time.Hour,
		trackBaseURL: u.srv.URL, trackGatewaySecret: testTrackSecret,
		docsBaseURL: u.srv.URL, docsGatewaySecret: testDocsSecret,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "areas-sid", "user-areas", "areas@example.com", "u-areas")
	s, _ := auth.sessions.get("areas-sid")
	s.trackWorkspaceID = "track-ws-areas"
	auth.sessions.put("areas-sid", s)
	a := newApp(cfg, auth)
	a.areas = a.workspaceAreas // Lens's read, not the package's open-everything test default
	a.cfg.webDist = t.TempDir()
	return a, &http.Cookie{Name: sessionCookieName, Value: "areas-sid"}
}

func serveAs(a *app, sess *http.Cookie, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// One BFF route of each hidden area that has any, and what a GET of it answers once the area is on
// (its handler's own answer: a route that takes only POST says so once the gate lets it through).
var areaProbes = []struct {
	area, path string
	on         int
}{
	{"marketplace", "/api/marketplace/mine", http.StatusOK},
	{"rooms", "/api/rooms", http.StatusOK},
	{"chat", "/api/chat/prompts", http.StatusOK},
	{"docs", "/api/docs/spaces", http.StatusOK},
	{"track", "/api/track/projects", http.StatusOK},
	{"scan", "/api/scan/watches", http.StatusOK},
	{"credit", "/api/wallets/loans", http.StatusOK},
	{"gateway", "/api/models", http.StatusOK},
	{"credit", "/api/agents/ag-1/loans", http.StatusMethodNotAllowed},
	{"scan", "/api/agents/ag-1/scan-watches", http.StatusMethodNotAllowed},
	{"chat", "/api/agents/prompt-schedules", http.StatusOK},
}

func TestAreas_AHiddenAreasRoutesAnswer404UntilLensListsTheArea(t *testing.T) {
	for _, p := range areaProbes {
		t.Run(p.area+p.path, func(t *testing.T) {
			u := newAreasUpstream(t)
			a, sess := areasApp(t, u)

			rec := serveAs(a, sess, p.path)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("default workspace: GET %s → %d (%s), want 404", p.path, rec.Code, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), p.area) {
				t.Errorf("the 404 names the area: %s", rec.Body.String())
			}

			u.set("rooms") // another area on changes nothing
			if p.area != "rooms" {
				if rec := serveAs(a, sess, p.path); rec.Code != http.StatusNotFound {
					t.Fatalf("only rooms on: GET %s → %d, want 404", p.path, rec.Code)
				}
			}

			u.set(p.area)
			if rec := serveAs(a, sess, p.path); rec.Code != p.on {
				t.Fatalf("%s on: GET %s → %d (%s), want %d", p.area, p.path, rec.Code, rec.Body.String(), p.on)
			}
		})
	}
}

func TestAreas_ALaunchRouteIsNeverGated(t *testing.T) {
	u := newAreasUpstream(t)
	a, sess := areasApp(t, u)
	for _, path := range []string{"/api/money/accounts", "/api/agents", "/api/agents/ag-1/rules", "/api/agents/schedules", "/api/wallets/credit-line", "/api/pooling", "/api/members"} {
		if got := areaOfPath(path); got != "" {
			t.Errorf("%s is in area %q; it is a launch route", path, got)
		}
	}
	if rec := serveAs(a, sess, "/api/workspace/name"); rec.Code == http.StatusNotFound {
		t.Fatalf("GET /api/workspace/name → 404 with no areas on")
	}
}

func TestAreas_UnreadableAreasHideTheArea(t *testing.T) {
	u := newAreasUpstream(t)
	a, sess := areasApp(t, u)
	u.set("rooms")
	u.mu.Lock()
	u.down = true
	u.mu.Unlock()
	if rec := serveAs(a, sess, "/api/rooms"); rec.Code != http.StatusNotFound {
		t.Fatalf("Lens down: GET /api/rooms → %d, want 404", rec.Code)
	}
}
