package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// B50.49 — getting a key back needs a REAL sign-in within the last 10 minutes. The sign-in time is the identity
// provider's auth_time from the verified id_token, never the moment the BFF made its session: a browser still signed
// in at the provider gets a new session without anyone typing anything, and that must not count.

// recoveryStartRelayed reports whether Lens was asked to start a recovery.
func recoveryStartRelayed(l *upstreamLog) bool {
	for _, h := range l.hits {
		if strings.HasSuffix(h.path, "/keys/recover/start") {
			return true
		}
	}
	return false
}

// sessionOf is the session the browser's cookie names.
func sessionOf(t *testing.T, a *app, ts string, client *http.Client) session {
	t.Helper()
	u, _ := url.Parse(ts)
	for _, c := range client.Jar.Cookies(u) {
		if c.Name == sessionCookieName {
			if s, ok := a.auth.session(c.Value); ok {
				return s
			}
		}
	}
	t.Fatal("the browser holds no session")
	return session{}
}

func TestRecoveryRefusesASilentSignInAtTheProvider(t *testing.T) {
	hourAgo := time.Now().Add(-time.Hour)
	for name, authTime := range map[string]*time.Time{"auth_time an hour old": &hourAgo, "no auth_time": nil} {
		t.Run(name, func(t *testing.T) {
			idp := newFakeIDP(t)
			idp.authTime = authTime
			var l upstreamLog
			_, ts, client := startOIDCBFF(t, idp, nil, nil, &l)
			if h := loginHops(t, ts, client, "/"); h.callback.StatusCode != http.StatusFound {
				t.Fatalf("callback: %d (%s)", h.callback.StatusCode, h.cbBody)
			}
			resp, body := doReq(t, client, http.MethodPost, ts.URL+"/api/agents/keys/recover/start")
			if resp.StatusCode != http.StatusForbidden || !strings.Contains(body, signInAgainSentence) {
				t.Fatalf("recover/start after a silent sign-in: %d (%s), want 403 %q", resp.StatusCode, body, signInAgainSentence)
			}
			if recoveryStartRelayed(&l) {
				t.Fatal("Lens was asked to start a recovery on a sign-in the person never made")
			}
		})
	}
}

func TestSignInAgainForRecoveryAsksTheProviderForANewSignIn(t *testing.T) {
	idp := newFakeIDP(t)
	hourAgo := time.Now().Add(-time.Hour)
	idp.authTime = &hourAgo
	var l upstreamLog
	a, ts, client := startOIDCBFF(t, idp, nil, nil, &l)

	login, body := doReq(t, client, http.MethodGet, ts.URL+"/auth/login?reauth=1&return_to="+url.QueryEscape("/agents/keys"))
	if login.StatusCode != http.StatusFound {
		t.Fatalf("login: %d (%s)", login.StatusCode, body)
	}
	loc, _ := url.Parse(login.Header.Get("Location"))
	if q := loc.Query(); q.Get("prompt") != "login" || q.Get("max_age") != "0" {
		t.Fatalf("the provider was asked prompt=%q max_age=%q, want login and 0", q.Get("prompt"), q.Get("max_age"))
	}
	idpResp, _ := doReq(t, client, http.MethodGet, loc.String())
	if cb, cbBody := doReq(t, client, http.MethodGet, idpResp.Header.Get("Location")); cb.StatusCode != http.StatusFound {
		t.Fatalf("callback: %d (%s)", cb.StatusCode, cbBody)
	}
	if s := sessionOf(t, a, ts.URL, client); time.Since(s.signedInAt) > time.Minute || s.signedInAt.Nanosecond() != 0 {
		t.Fatalf("signed in at %v, want the provider's auth_time from just now", s.signedInAt)
	}
	resp, out := doReq(t, client, http.MethodPost, ts.URL+"/api/agents/keys/recover/start")
	if resp.StatusCode != http.StatusOK || !recoveryStartRelayed(&l) {
		t.Fatalf("recover/start after signing in again: %d (%s), relayed %v", resp.StatusCode, out, recoveryStartRelayed(&l))
	}
}

func TestAPhoneSessionTakesItsSignInTimeFromTheIDToken(t *testing.T) {
	idp := newFakeIDP(t)
	var l upstreamLog
	a, ts, _ := startOIDCBFF(t, idp, nil, func(c *config) { c.oidcMobileClientIDs = []string{"phone-android"} }, &l)
	phone := &http.Client{Transport: ts.Client().Transport}
	idp.aud = "phone-android"
	hourAgo := time.Now().Add(-time.Hour).Truncate(time.Second)
	idp.authTime = &hourAgo

	resp, err := phone.Post(ts.URL+mobileSessionPath, "application/json", strings.NewReader(`{"id_token":"`+idp.mintIDToken("")+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Token string `json:"token"`
	}
	err = json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("phone sign-in: %d, %v", resp.StatusCode, err)
	}
	s, ok := a.auth.session(out.Token)
	if !ok || !s.signedInAt.Equal(hourAgo) {
		t.Fatalf("phone session %v signed in at %v, want the id_token's auth_time %v", ok, s.signedInAt, hourAgo)
	}
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/agents/keys/recover/start", nil)
	req.Header.Set("Authorization", "Bearer "+out.Token)
	start, err := phone.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	start.Body.Close()
	if start.StatusCode != http.StatusForbidden || recoveryStartRelayed(&l) {
		t.Fatalf("phone recover/start on an hour-old sign-in: %d, relayed %v; want 403 and nothing sent", start.StatusCode, recoveryStartRelayed(&l))
	}
}
