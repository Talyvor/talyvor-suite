package main

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Config matrix: BFF_AUTH_MODE is the new fail-closed switch. There is no
// default — the operator must SAY whether this process authenticates, because
// inc2's only protection (loopback bind) stops being the whole story here.
// ---------------------------------------------------------------------------

// clearBFFEnv blanks every env var loadConfig reads, then applies overrides.
// t.Setenv restores automatically.
func clearBFFEnv(t *testing.T, overrides map[string]string) {
	t.Helper()
	keys := []string{
		"BFF_ADDR", "LENS_BASE_URL", "LENS_WORKSPACE_KEY", "LENS_WORKSPACE_ID", "WEB_DIST",
		"BFF_AUTH_MODE", "BFF_PUBLIC_BASE_URL", "BFF_SESSION_TTL",
		"OIDC_ISSUER", "OIDC_ALLOWED_EMAILS",
	}
	for _, k := range keys {
		t.Setenv(k, "")
	}
	for k, v := range overrides {
		t.Setenv(k, v)
	}
}

// validOIDCEnv is a fully-specified, valid oidc-mode environment on a loopback
// bind: https issuer, https public base URL with an empty path, allowlist set.
func validOIDCEnv() map[string]string {
	return map[string]string{
		"LENS_PROVISION_SECRET": testProvisionSecret,
		"LENS_WORKSPACE_ID":     "trial-ws-1",
		"BFF_AUTH_MODE":         "oidc",
		"OIDC_ISSUER":           "https://idp.example.com",
		"BFF_PUBLIC_BASE_URL":   "https://app.talyvor.com",
		"OIDC_ALLOWED_EMAILS":   "ng@example.com",
	}
}

func TestLoadConfigAuthMatrix(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string // applied over a cleared env
		wantErr string            // "" = must succeed; else substring of the error
	}{
		{
			// The new requirement itself: a config that was complete in inc2
			// (key + id + loopback) must now REFUSE to start until the operator
			// declares an auth mode. Silence is not a mode.
			name:    "no auth mode refuses",
			env:     map[string]string{"LENS_PROVISION_SECRET": testProvisionSecret},
			wantErr: "BFF_AUTH_MODE",
		},
		{
			name: "unknown auth mode refuses",
			env: map[string]string{
				"LENS_PROVISION_SECRET": testProvisionSecret,
				"BFF_AUTH_MODE":         "clerk",
			},
			wantErr: "BFF_AUTH_MODE",
		},
		{
			// disabled == inc2 behaviour, explicitly chosen: loopback only.
			name: "disabled on loopback boots",
			env: map[string]string{
				"LENS_PROVISION_SECRET": testProvisionSecret,
				"BFF_AUTH_MODE":         "disabled",
			},
		},
		{
			// THE NON-REGRESSION: disabled (no auth) + non-loopback must still
			// hard-fail exactly as inc2 did. Auth arriving in the codebase must
			// not relax this as a side effect.
			name: "disabled on non-loopback still refuses",
			env: map[string]string{
				"LENS_PROVISION_SECRET": testProvisionSecret,
				"BFF_AUTH_MODE":         "disabled", "BFF_ADDR": "0.0.0.0:8787",
			},
			wantErr: "loopback",
		},
		{
			name: "oidc fully specified on loopback boots",
			env:  validOIDCEnv(),
		},
		{
			name:    "oidc missing issuer refuses",
			env:     without(validOIDCEnv(), "OIDC_ISSUER"),
			wantErr: "OIDC_ISSUER",
		},
		{
			name:    "oidc missing allowlist refuses",
			env:     without(validOIDCEnv(), "OIDC_ALLOWED_EMAILS"),
			wantErr: "OIDC_ALLOWED_EMAILS",
		},
		{
			name:    "oidc missing public base URL refuses",
			env:     without(validOIDCEnv(), "BFF_PUBLIC_BASE_URL"),
			wantErr: "BFF_PUBLIC_BASE_URL",
		},
		{
			// The __Host- session cookie requires Secure, so the public origin
			// must be https. Plain http is allowed only on loopback (dev).
			name:    "oidc public base URL http non-loopback refuses",
			env:     with(validOIDCEnv(), "BFF_PUBLIC_BASE_URL", "http://app.talyvor.com"),
			wantErr: "https",
		},
		{
			name: "oidc public base URL http loopback boots (dev)",
			env:  with(validOIDCEnv(), "BFF_PUBLIC_BASE_URL", "http://127.0.0.1:8787"),
		},
		{
			// __Host- forces Path=/ — a base URL with a path would silently
			// mis-scope the cookie, so refuse it outright.
			name:    "oidc public base URL with path refuses",
			env:     with(validOIDCEnv(), "BFF_PUBLIC_BASE_URL", "https://app.talyvor.com/app"),
			wantErr: "path",
		},
		{
			// THE DELIBERATE RELAXATION: with auth proven on (oidc mode) and an
			// https public origin, a non-loopback bind is allowed — this is the
			// container/remote-proxy deployment. Everything else still refuses.
			name: "oidc https public origin may bind non-loopback",
			env:  with(with(validOIDCEnv(), "BFF_ADDR", "0.0.0.0:8787"), "BFF_PUBLIC_BASE_URL", "https://app.talyvor.com"),
		},
		{
			// A dev cookie posture (http loopback public URL) must NOT be
			// combined with a public bind.
			name:    "oidc dev public URL cannot bind non-loopback",
			env:     with(with(validOIDCEnv(), "BFF_ADDR", "0.0.0.0:8787"), "BFF_PUBLIC_BASE_URL", "http://127.0.0.1:8787"),
			wantErr: "loopback",
		},
		{
			// B61.29: the issuer is only the namespace existing people's identities were made under; nothing is
			// fetched from it, so its scheme no longer matters.
			name: "oidc issuer http boots (a namespace, never fetched)",
			env:  with(validOIDCEnv(), "OIDC_ISSUER", "http://127.0.0.1:5556/dex"),
		},
		{
			name:    "oidc zero session TTL refuses",
			env:     with(validOIDCEnv(), "BFF_SESSION_TTL", "0s"),
			wantErr: "BFF_SESSION_TTL",
		},
		{
			name:    "oidc junk session TTL refuses",
			env:     with(validOIDCEnv(), "BFF_SESSION_TTL", "tomorrow"),
			wantErr: "BFF_SESSION_TTL",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			clearBFFEnv(t, c.env)
			_, err := loadConfig()
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("want success, got: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("want error containing %q, got success", c.wantErr)
			}
			if !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("want error containing %q, got: %v", c.wantErr, err)
			}
		})
	}
}

func with(m map[string]string, k, v string) map[string]string {
	out := make(map[string]string, len(m)+1)
	for kk, vv := range m {
		out[kk] = vv
	}
	out[k] = v
	return out
}

func without(m map[string]string, k string) map[string]string {
	out := make(map[string]string, len(m))
	for kk, vv := range m {
		if kk != k {
			out[kk] = vv
		}
	}
	return out
}

func boolPtr(b bool) *bool { return &b }

// testIssuer is the namespace the identities of people who first signed in with Google were made under (OIDC_ISSUER):
// nothing is fetched from it (B61.29).
const testIssuer = "https://accounts.example.test"

// signInAs signs client in as (sub, email) the way a sign-in lands: Lens provisions the identity (with sign-up's
// answers, if any), the session is stored and its cookie goes into client's jar. It stands in for the Google round
// trip these tests once drove (B61.29); the door itself is tested in b6125_phone_signin_test.go. Answers the id.
func signInAsSub(t *testing.T, a *app, ts *httptest.Server, client *http.Client, sub, email string, signup signupAccount) string {
	t.Helper()
	prov, err := a.provisionAs(t.Context(), a.identityOf(sub), provisionAsk{}, nil, signup)
	if err != nil {
		t.Fatalf("provision %s: %v", sub, err)
	}
	now := time.Now()
	sid, err := a.auth.storeSession(session{sub: sub, email: strings.ToLower(email), expires: now.Add(time.Hour),
		workspaceID: prov.WorkspaceID, lensToken: prov.Token, lensTokenExp: parseExpiry(prov.ExpiresAt),
		cachePoolable: prov.CachePoolable, needsPoolingChoice: prov.Created, signedInAt: now})
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(ts.URL)
	client.Jar.SetCookies(u, []*http.Cookie{{Name: sessionCookieName, Value: sid, Path: "/", Secure: true, HttpOnly: true}})
	return sid
}

// ---------------------------------------------------------------------------
// Stack helpers: the BFF runs under a TLS httptest server so the Secure
// __Host- cookies genuinely round-trip through a cookie jar — nothing about
// the cookie posture is simulated.
// ---------------------------------------------------------------------------

// startOIDCBFF builds an oidc-mode BFF whose public base URL IS its TLS URL,
// backed by fake Lens. Returns the app (for store seeding), the TLS
// server, and a jar-carrying client that does NOT follow redirects.
// ⚠ THE `log` PARAMETER IS VARIADIC SO THE SEVENTEEN EXISTING CALLERS ARE UNTOUCHED. Only the
// sweep needs per-request detail; widening the signature for everyone would edit seventeen call
// sites to add a recorder sixteen of them ignore, and every one of those edits is a chance to
// pass the wrong thing to a fixture that then looks instrumented.
func startOIDCBFF(t *testing.T, gotAuth *string, mutate func(*config), log ...*upstreamLog) (*app, *httptest.Server, *http.Client) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		if gotAuth != nil {
			*gotAuth = r.Header.Get("Authorization")
		}
		for _, l := range log {
			if l != nil {
				l.hits = append(l.hits, upstreamHit{path: r.URL.Path, auth: r.Header.Get("Authorization")})
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"path":"`+r.URL.Path+`","query":"`+r.URL.RawQuery+`"}`)
	}))
	t.Cleanup(upstream.Close)

	// The public origin must be known before the app exists, and must equal the
	// TLS server's URL — so make the listener first.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cfg := config{
		addr: "127.0.0.1:0", lensBaseURL: upstream.URL,
		provisionSecret: testProvisionSecret, webDist: t.TempDir(),
		authMode: authModeOIDC, oidcIssuer: testIssuer,
		publicBaseURL: "https://" + ln.Addr().String(),
		allowedEmails: []string{"ng@example.com"},
		sessionTTL:    time.Hour,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	auth := newAuthenticator(cfg)
	a := newApp(cfg, auth)
	ts := httptest.NewUnstartedServer(a)
	ts.Listener.Close()
	ts.Listener = ln
	ts.StartTLS()
	t.Cleanup(ts.Close)
	if ts.URL != cfg.publicBaseURL {
		t.Fatalf("test rig: TLS URL %s != public base URL %s", ts.URL, cfg.publicBaseURL)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{
		Transport:     ts.Client().Transport, // trusts the test server's cert
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return a, ts, client
}

// get issues a GET (or POST with empty body when post=true), returns the
// response and its fully-read body. The body is closed.
// testServerOrigin extracts scheme://host from a test-server URL — the Origin a browser on
// that server would send.
func testServerOrigin(u string) string {
	p, err := url.Parse(u)
	if err != nil || p.Scheme == "" || p.Host == "" {
		return ""
	}
	return p.Scheme + "://" + p.Host
}

func doReq(t *testing.T, client *http.Client, method, u string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, u, nil)
	if err != nil {
		t.Fatal(err)
	}
	// A browser sends Origin on every write, and the BFF's single write-path gate
	// (app.sameOriginWriteAllowed) requires it. Sending it here keeps these tests exercising
	// the behaviour they are about — method surfaces, cookies, redirects — rather than
	// tripping the gate on a request shape no browser produces.
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		if o := testServerOrigin(u); o != "" {
			req.Header.Set("Origin", o)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, u, err)
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	return resp, string(body)
}

// nakedClient is a jar-less client for the same TLS server: shares the
// transport (cert trust) but carries NO cookies — httptest's own Client() is a
// shared instance and must not be reused as "unauthenticated".
func nakedClient(ts *httptest.Server) *http.Client {
	return &http.Client{
		Transport:     ts.Client().Transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func cookieNamed(resp *http.Response, name string) *http.Cookie {
	for _, c := range resp.Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// The behaviours.
// ---------------------------------------------------------------------------

// TestAPIRequiresSession: every /api route in oidc mode is 401 without a valid
// session — missing, garbage, and expired cookies all refuse explicitly.
func TestAPIRequiresSession(t *testing.T) {
	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, sessionTTL: time.Hour,
	}
	auth := newAuthenticator(cfg)
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()

	endpoints := []string{
		"/api/context", "/api/lxc/balance", "/api/tokens/balance",
		"/api/tokens/history", "/api/lxc/history", "/api/workspaces", "/api/bonds",
		"/api/track/workspaces", "/api/docs/spaces", // inc6 product routes: same gate
		"/api/keys", "/api/members", "/api/spend/month", // shared-unblock routes: same gate
		"/api/track/issues", "/api/track/issues/isu-1", // Track Tier-1: same gate
		"/api/track/issues/isu-1/comments", "/api/track/teams",
		"/api/anything-unknown",
	}
	for _, ep := range endpoints {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ep, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s no cookie: got %d, want 401", ep, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "auth") {
			t.Errorf("%s: 401 body must name the problem: %s", ep, rec.Body.String())
		}
	}

	// Garbage session id.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "no-such-session"})
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("garbage session: got %d, want 401", rec.Code)
	}

	// Expired session.
	auth.sessions.put("expired-sid", session{sub: "u", email: "ng@example.com", expires: time.Now().Add(-time.Minute)})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "expired-sid"})
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expired session: got %d, want 401", rec.Code)
	}

	// Valid session: through.
	seedProvisionedSession(auth, "valid-sid", "u", "ng@example.com", "u-test-workspace")
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "valid-sid"})
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("valid session: got %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
}

// TestLogout: POST /auth/logout destroys the server-side session and expires
// the cookie; the old cookie value is dead afterwards. GET is refused.
func TestLogout(t *testing.T) {
	a, ts, client := startOIDCBFF(t, nil, nil)
	sid := signInAsSub(t, a, ts, client, "u-logout", "ng@example.com", signupAccount{})

	// GET refused.
	gresp, _ := doReq(t, client, http.MethodGet, ts.URL+"/auth/logout")
	if gresp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET logout: got %d, want 405", gresp.StatusCode)
	}
	if gresp.Header.Get("Allow") != "POST" {
		t.Fatalf("GET logout Allow = %q, want POST", gresp.Header.Get("Allow"))
	}

	resp, _ := doReq(t, client, http.MethodPost, ts.URL+"/auth/logout")
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout: got %d, want 204", resp.StatusCode)
	}
	if ck := cookieNamed(resp, sessionCookieName); ck == nil || ck.MaxAge >= 0 {
		t.Fatalf("logout must expire the session cookie: %+v", ck)
	}

	// The jar dropped the cookie; but even resending the OLD value must 401 —
	// the session died server-side, not just in the browser.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
	r2, err := nakedClient(ts).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r2.Body.Close()
	if r2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old session after logout: got %d, want 401", r2.StatusCode)
	}
}

// TestAuthMe: the UI's one probe. Always 200; reports mode and identity.
func TestAuthMe(t *testing.T) {
	a, ts, client := startOIDCBFF(t, nil, nil)

	resp, body := doReq(t, client, http.MethodGet, ts.URL+"/auth/me")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("me unauthenticated: got %d", resp.StatusCode)
	}
	var me struct {
		Mode          string `json:"mode"`
		Authenticated bool   `json:"authenticated"`
		User          *struct {
			Email string `json:"email"`
			Sub   string `json:"sub"`
		} `json:"user"`
	}
	if err := json.Unmarshal([]byte(body), &me); err != nil {
		t.Fatalf("me: %v (%s)", err, body)
	}
	if me.Mode != "oidc" || me.Authenticated || me.User != nil {
		t.Fatalf("me unauthenticated = %+v", me)
	}

	signInAsSub(t, a, ts, client, "u-me", "ng@example.com", signupAccount{})
	_, body = doReq(t, client, http.MethodGet, ts.URL+"/auth/me")
	if err := json.Unmarshal([]byte(body), &me); err != nil {
		t.Fatal(err)
	}
	if !me.Authenticated || me.User == nil || me.User.Email != "ng@example.com" {
		t.Fatalf("me authenticated = %+v (%s)", me, body)
	}
	if strings.Contains(body, "tlv_ws_") {
		t.Fatalf("me leaked a key: %s", body)
	}
}

// TestAuthEndpointsInDisabledMode: in disabled mode sign-in is
// absent (explicit 404, not a silent SPA fallback), /auth/me reports the mode,
// and /api needs no session — the loopback bind is the guard, as in inc2.
func TestAuthEndpointsInDisabledMode(t *testing.T) {
	a := newApp(config{
		lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret,
		webDist: t.TempDir(), authMode: authModeDisabled,
	}, nil)

	for _, ep := range []struct{ method, path string }{
		{http.MethodPost, "/auth/logout"},
	} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(ep.method, ep.path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s in disabled mode: got %d, want 404", ep.method, ep.path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "disabled") {
			t.Errorf("%s %s: body should say auth is disabled: %s", ep.method, ep.path, rec.Body.String())
		}
	}

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/auth/me", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "disabled") {
		t.Fatalf("/auth/me in disabled mode: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/context", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/api/context in disabled mode should need no session: %d", rec.Code)
	}
}

// TestKeyNeverReachesResponseOIDC extends THE inc2 assertion across the auth
// surface: with a live session, no /api or /auth response — body or header —
// ever contains the workspace key.
//
// ⚠⚠ AND ITS FLIP SIDE HAD THE SAME POSITIONAL DEFECT AS ITS SIBLING IN bff_test.go — ONE CHECK
// AFTER THE LOOP, AGAINST A SINGLE STRING EVERY ENDPOINT OVERWROTE. MEASURED at `49fd5f2`, with
// `doGet` changed to attach the credential ONLY on `/v1/bonds` (the last of the SIX that reach
// Lens here): **this test PASSED**. Five proxying routes sent no key and the assertion was
// satisfied by the sixth. Its own message said "upstream NEVER received a bearer credential",
// which is the giveaway once seen: it only ever asserted that AT LEAST ONE request carried one.
//
// ⚠ FIXED IN THE SAME MERGE AS THE SIBLING, DELIBERATELY. This repository's recurring shape is
// "the fix applied where the defect was reported and the identical shape one element over never
// swept for" — W1.1.9a's record names it in those words. Two instances, one finding, one merge.
func TestKeyNeverReachesResponseOIDC(t *testing.T) {
	var gotAuth string
	log := &upstreamLog{}
	a, ts, client := startOIDCBFF(t, &gotAuth, nil, log)

	signInAsSub(t, a, ts, client, "u-sweep", "ng@example.com", signupAccount{})
	sweep := func(name string, resp *http.Response, body string) {
		t.Helper()
		// Needles from the app's own config: the provisioning secret among them.
		assertNoSecretLeak(t, name, a.cfg, body, resp.Header)
	}

	// Which of these reach Lens, MEASURED and pinned — the same reason bff_test.go's
	// KEY_SWEEP_PROXIES is pinned: /api/context is answered locally and /auth/me is the BFF's own
	// session read, so "a credential everywhere" is false, and "assert only where one arrived"
	// would let a route that stopped proxying drop silently out of the assertion.
	oidcProxies := map[string]bool{
		"/api/context":                         false,
		"/api/lxc/balance":                     true,
		"/api/tokens/balance":                  true,
		"/api/tokens/history?limit=5&offset=0": true,
		"/api/lxc/history?limit=5&offset=0":    true,
		"/api/workspaces":                      true,
		"/api/bonds":                           true,
		"/auth/me":                             false,
	}
	measured := map[string]bool{}
	for _, ep := range []string{
		"/api/context", "/api/lxc/balance", "/api/tokens/balance",
		"/api/tokens/history?limit=5&offset=0", "/api/lxc/history?limit=5&offset=0",
		"/api/workspaces", "/api/bonds", "/auth/me",
	} {
		before := len(log.hits)
		resp, body := doReq(t, client, http.MethodGet, ts.URL+ep)
		sweep(ep, resp, body)

		hits := log.hits[before:]
		measured[ep] = len(hits) > 0
		for _, hit := range hits {
			if !strings.HasPrefix(hit.auth, "Bearer ") || hit.auth == "Bearer " {
				t.Errorf("%s → upstream %s received Authorization %q: with a live OIDC session "+
					"the proxy did not attach the workspace token server-side for this route",
					ep, hit.path, hit.auth)
			}
		}
	}

	for ep, want := range oidcProxies {
		if measured[ep] != want {
			t.Errorf("%s: proxied to Lens = %v, the pinned table says %v — one of the two is "+
				"stale. A route that stops proxying loses its credential assertion silently.",
				ep, measured[ep], want)
		}
	}
	proxying := 0
	for _, ok := range measured {
		if ok {
			proxying++
		}
	}
	if proxying < 3 {
		t.Fatalf("only %d swept endpoints reached the upstream — the credential assertions above "+
			"are close to vacuous", proxying)
	}
}
