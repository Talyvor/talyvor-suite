package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// B17.2 — a synthetic user signs in with the operator key and chats through the real app; a real
// account, a request without the key, and a BFF without the key are all refused.

const (
	testSyntheticKey = "synthetic-operator-key-for-tests"
	testSyntheticWS  = "sabcdefghijklmnopqrstuvwxyz"
	testRealWS       = "u7realworkspaceabcdefghijkl"
)

// syntheticLens fakes the four Lens routes a synthetic user's session touches, and counts
// provisioning, which a synthetic session must never reach.
type syntheticLens struct {
	srv *httptest.Server

	mu             sync.Mutex
	provisionCalls int
	gotMintAuth    string
	gotProxyAuth   string
	gotReadAuth    string
}

func newSyntheticLens(t *testing.T) *syntheticLens {
	t.Helper()
	byToken := map[string]lensWorkspaceRecord{
		"jwt-synthetic": {ID: testSyntheticWS, Active: true, CachePoolable: true, Synthetic: true},
		"jwt-real":      {ID: testRealWS, Active: true, CachePoolable: true, Synthetic: false},
	}
	l := &syntheticLens{}
	l.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		l.mu.Lock()
		defer l.mu.Unlock()
		auth := r.Header.Get("Authorization")
		switch {
		case r.URL.Path == provisionPath:
			l.provisionCalls++
			serveFakeProvision(w, r)
		case r.URL.Path == lensSessionKeyPath:
			l.gotMintAuth = auth
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"key":%q,"expires_at":%q}`, testSessionKey,
				time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		case strings.HasPrefix(r.URL.Path, "/v1/proxy/"):
			l.gotProxyAuth = auth
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: 2+2 is 4\n\n")
		case strings.HasPrefix(r.URL.Path, "/v1/workspaces/"):
			// Lens's isolation middleware: a token reads its own workspace and nothing else.
			rec, ok := byToken[strings.TrimPrefix(auth, "Bearer ")]
			rest := strings.TrimPrefix(r.URL.Path, "/v1/workspaces/")
			id, suffix, _ := strings.Cut(rest, "/")
			switch {
			case !ok:
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			case rec.ID != id:
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			case suffix == "":
				_ = json.NewEncoder(w).Encode(rec)
			default:
				l.gotReadAuth = auth
				_, _ = io.WriteString(w, `{"balance":1000}`)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(l.srv.Close)
	return l
}

func syntheticApp(t *testing.T, lens *syntheticLens, key string) *app {
	t.Helper()
	cfg := config{
		lensBaseURL: lens.srv.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
		syntheticKey: key,
	}
	a := newApp(cfg, newSessionOnlyAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()
	return a
}

// syntheticSignIn POSTs to /auth/synthetic the way the harness's headless browser does: same
// Origin, the operator key in its header, one workspace from Lens's create call in the body.
func syntheticSignIn(t *testing.T, ts *httptest.Server, key, wsID, token, expiresAt string) (*http.Response, *http.Cookie) {
	t.Helper()
	body := fmt.Sprintf(`{"workspace_id":%q,"token":%q,"expires_at":%q}`, wsID, token, expiresAt)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/auth/synthetic", strings.NewReader(body))
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set(syntheticKeyHeader, key)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("sign in: %v", err)
	}
	defer resp.Body.Close()
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookieName && c.Value != "" {
			return resp, c
		}
	}
	return resp, nil
}

func TestSyntheticUserSignsInAndChatsThroughTheApp(t *testing.T) {
	lens := newSyntheticLens(t)
	a := syntheticApp(t, lens, testSyntheticKey)
	ts := httptest.NewServer(a)
	defer ts.Close()

	resp, sess := syntheticSignIn(t, ts, testSyntheticKey, testSyntheticWS, "jwt-synthetic", "")
	if resp.StatusCode != http.StatusOK || sess == nil {
		t.Fatalf("synthetic sign-in: status %d, session cookie %v", resp.StatusCode, sess)
	}

	// The app's own probe sees a signed-in user in the synthetic workspace, with no pooling question.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/auth/me", nil)
	req.AddCookie(sess)
	me, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Authenticated      bool              `json:"authenticated"`
		User               map[string]string `json:"user"`
		WorkspaceID        string            `json:"workspace_id"`
		NeedsPoolingChoice bool              `json:"needs_pooling_choice"`
	}
	_ = json.NewDecoder(me.Body).Decode(&got)
	me.Body.Close()
	if !got.Authenticated || got.WorkspaceID != testSyntheticWS || got.NeedsPoolingChoice ||
		got.User["email"] != testSyntheticWS+syntheticEmailDomain {
		t.Fatalf("/auth/me after synthetic sign-in = %+v", got)
	}

	// A chat message goes through the same stream route the Chat screen uses.
	resp, br, done := openStream(t, a, sess, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
	answer, _ := io.ReadAll(br)
	done()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(answer), "2+2 is 4") {
		t.Fatalf("chat as a synthetic user: status %d, body %q", resp.StatusCode, answer)
	}
	if lens.gotMintAuth != "Bearer jwt-synthetic" || lens.gotProxyAuth != "Bearer "+testSessionKey {
		t.Fatalf("mint carried %q, proxy carried %q — the chat must run on the synthetic workspace's own credential",
			lens.gotMintAuth, lens.gotProxyAuth)
	}
}

// syntheticPhoneSignIn POSTs to /auth/synthetic/mobile the way the phone harness does: no Origin, no
// cookie jar, the operator key in its header. It returns the Bearer token, "" when none was issued.
func syntheticPhoneSignIn(t *testing.T, ts *httptest.Server, key, wsID, token, expiresAt string) (*http.Response, string) {
	t.Helper()
	body := fmt.Sprintf(`{"workspace_id":%q,"token":%q,"expires_at":%q}`, wsID, token, expiresAt)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+syntheticMobilePath, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set(syntheticKeyHeader, key)
	}
	resp, err := (&http.Client{Transport: ts.Client().Transport}).Do(req)
	if err != nil {
		t.Fatalf("phone sign in: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out.Token
}

// B57.86 — a synthetic user signs the phone app in: a Bearer session, no cookie, that /api/agents
// accepts and that runs on the synthetic workspace's own token.
func TestSyntheticPhoneSignInGetsABearerSessionAgentsAccepts(t *testing.T) {
	lens := newSyntheticLens(t)
	a := syntheticApp(t, lens, testSyntheticKey)
	ts := httptest.NewServer(a)
	defer ts.Close()

	resp, tok := syntheticPhoneSignIn(t, ts, testSyntheticKey, testSyntheticWS, "jwt-synthetic", "")
	if resp.StatusCode != http.StatusOK || tok == "" {
		t.Fatalf("synthetic phone sign-in: status %d, token %q", resp.StatusCode, tok)
	}
	if c := resp.Header.Values("Set-Cookie"); len(c) != 0 {
		t.Errorf("a phone sign-in set cookies %v; it must set none", c)
	}
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/agents", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	agents, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	agents.Body.Close()
	if agents.StatusCode != http.StatusOK || lens.gotReadAuth != "Bearer jwt-synthetic" {
		t.Fatalf("GET /api/agents with the Bearer token: status %d with %q, want 200 with the synthetic token",
			agents.StatusCode, lens.gotReadAuth)
	}
	if lens.provisionCalls != 0 {
		t.Fatalf("a synthetic phone session called /v1/provision %d time(s) — that creates a real workspace", lens.provisionCalls)
	}
}

func TestSyntheticSignInRefusesRealAccountsAndRequestsWithoutTheKey(t *testing.T) {
	cases := []struct {
		name, bffKey, sentKey, wsID, token string
		want                               int
	}{
		{"key unset on the BFF", "", testSyntheticKey, testSyntheticWS, "jwt-synthetic", http.StatusNotFound},
		{"no key", testSyntheticKey, "", testSyntheticWS, "jwt-synthetic", http.StatusUnauthorized},
		{"wrong key", testSyntheticKey, "not-the-key", testSyntheticWS, "jwt-synthetic", http.StatusUnauthorized},
		{"a real account with its own valid token", testSyntheticKey, testSyntheticKey, testRealWS, "jwt-real", http.StatusForbidden},
		{"a real account's id with a synthetic token", testSyntheticKey, testSyntheticKey, testRealWS, "jwt-synthetic", http.StatusForbidden},
		{"a synthetic id with a real account's token", testSyntheticKey, testSyntheticKey, testSyntheticWS, "jwt-real", http.StatusForbidden},
		{"a token Lens does not know", testSyntheticKey, testSyntheticKey, testSyntheticWS, "jwt-forged", http.StatusForbidden},
		{"a path in the workspace id", testSyntheticKey, testSyntheticKey, testSyntheticWS + "/../" + testRealWS, "jwt-real", http.StatusBadRequest},
	}
	// Both doors: the browser's cookie and the phone's Bearer token (B57.86) refuse alike.
	for _, phone := range []bool{false, true} {
		for _, tc := range cases {
			t.Run(fmt.Sprintf("%s/phone=%t", tc.name, phone), func(t *testing.T) {
				lens := newSyntheticLens(t)
				a := syntheticApp(t, lens, tc.bffKey)
				ts := httptest.NewServer(a)
				defer ts.Close()
				var resp *http.Response
				if phone {
					var tok string
					resp, tok = syntheticPhoneSignIn(t, ts, tc.sentKey, tc.wsID, tc.token, "")
					if tok != "" {
						t.Errorf("a Bearer token was issued")
					}
				} else {
					var sess *http.Cookie
					resp, sess = syntheticSignIn(t, ts, tc.sentKey, tc.wsID, tc.token, "")
					if sess != nil {
						t.Errorf("a session cookie was set: %v", sess)
					}
				}
				if resp.StatusCode != tc.want {
					t.Errorf("status = %d, want %d", resp.StatusCode, tc.want)
				}
				a.auth.sessions.mu.Lock()
				n := len(a.auth.sessions.m)
				a.auth.sessions.mu.Unlock()
				if n != 0 {
					t.Errorf("%d session(s) stored — a refused sign-in must store none", n)
				}
			})
		}
	}
}

// A synthetic session whose token is about to expire must not be re-provisioned: provisioning its
// sub would create a REAL workspace and move the session into it.
func TestSyntheticSessionIsNeverReprovisioned(t *testing.T) {
	lens := newSyntheticLens(t)
	a := syntheticApp(t, lens, testSyntheticKey)
	ts := httptest.NewServer(a)
	defer ts.Close()

	soon := time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339) // inside the re-mint skew
	resp, sess := syntheticSignIn(t, ts, testSyntheticKey, testSyntheticWS, "jwt-synthetic", soon)
	if resp.StatusCode != http.StatusOK || sess == nil {
		t.Fatalf("synthetic sign-in: status %d", resp.StatusCode)
	}
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/lxc/balance", nil)
	req.AddCookie(sess)
	bal, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	bal.Body.Close()
	if bal.StatusCode != http.StatusOK || lens.gotReadAuth != "Bearer jwt-synthetic" {
		t.Fatalf("balance read: status %d with %q, want 200 with the synthetic token", bal.StatusCode, lens.gotReadAuth)
	}
	if lens.provisionCalls != 0 {
		t.Fatalf("a synthetic session called /v1/provision %d time(s) — that creates a real workspace", lens.provisionCalls)
	}
}

// B54.32 — every synthetic sign-in attempt, on either door, writes exactly one log line naming its
// outcome and its door, and never the operator key or the Lens token.
func TestSyntheticSignInLogsEveryAttemptWithItsDoor(t *testing.T) {
	past := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	cases := []struct {
		name, outcome, bffKey, method, sentKey, body string
	}{
		{"key unset on the BFF", "not-enabled", "", http.MethodPost, testSyntheticKey, ""},
		{"wrong method", "wrong-method", testSyntheticKey, http.MethodGet, testSyntheticKey, ""},
		{"wrong key", "bad-key", testSyntheticKey, http.MethodPost, "not-the-key", ""},
		{"bad body", "bad-body", testSyntheticKey, http.MethodPost, testSyntheticKey, `{"workspace_id":`},
		{"a real account", "refused-by-lens", testSyntheticKey, http.MethodPost, testSyntheticKey,
			fmt.Sprintf(`{"workspace_id":%q,"token":"jwt-real"}`, testRealWS)},
		{"an expired token", "expired", testSyntheticKey, http.MethodPost, testSyntheticKey,
			fmt.Sprintf(`{"workspace_id":%q,"token":"jwt-synthetic","expires_at":%q}`, testSyntheticWS, past)},
		{"signed in", "created", testSyntheticKey, http.MethodPost, testSyntheticKey,
			fmt.Sprintf(`{"workspace_id":%q,"token":"jwt-synthetic"}`, testSyntheticWS)},
	}
	for _, door := range []struct{ name, path string }{{"browser", "/auth/synthetic"}, {"phone", syntheticMobilePath}} {
		for _, tc := range cases {
			t.Run(tc.name+"/"+door.name, func(t *testing.T) {
				lens := newSyntheticLens(t)
				ts := httptest.NewServer(syntheticApp(t, lens, tc.bffKey))
				defer ts.Close()
				req, _ := http.NewRequest(tc.method, ts.URL+door.path, strings.NewReader(tc.body))
				req.Header.Set("Origin", "https://app.talyvor.com")
				req.Header.Set(syntheticKeyHeader, tc.sentKey)

				var logs strings.Builder
				prev := log.Writer()
				log.SetOutput(&logs)
				resp, err := ts.Client().Do(req)
				log.SetOutput(prev)
				if err != nil {
					t.Fatal(err)
				}
				resp.Body.Close()

				var lines []string
				for _, l := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
					if strings.Contains(l, "synthetic sign-in") {
						lines = append(lines, l)
					}
				}
				want := "synthetic sign-in " + tc.outcome + " door=" + door.name
				if len(lines) != 1 || !strings.Contains(lines[0], want) {
					t.Fatalf("log lines = %q, want exactly one containing %q", lines, want)
				}
				for _, secret := range []string{testSyntheticKey, "not-the-key", "jwt-real", "jwt-synthetic"} {
					if strings.Contains(logs.String(), secret) {
						t.Errorf("the log carries %q: %q", secret, logs.String())
					}
				}
			})
		}
	}
}

// B50.36 — the phone harness sends no Origin; a page on another site always does. Sent from another
// site, even with the operator key and a session cookie, the phone's synthetic door is refused 403
// before it runs, as every other write the BFF registers is.
func TestSyntheticPhoneSignInRefusesAnotherSite(t *testing.T) {
	lens := newSyntheticLens(t)
	a := syntheticApp(t, lens, testSyntheticKey)
	body := fmt.Sprintf(`{"workspace_id":%q,"token":"jwt-synthetic"}`, testSyntheticWS)
	req := httptest.NewRequest(http.MethodPost, syntheticMobilePath, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(syntheticKeyHeader, testSyntheticKey)
	req.Header.Set("Origin", "https://evil.example")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "any"})
	rr := httptest.NewRecorder()
	a.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden || !strings.Contains(rr.Body.String(), "cross-origin write refused") {
		t.Fatalf("cross-site POST %s = %d %s, want 403 cross-origin write refused", syntheticMobilePath, rr.Code, rr.Body.String())
	}
}
