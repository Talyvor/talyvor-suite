package main

import (
	"net/http"
	"strings"
	"testing"
)

// B61.29 — Google sign-in is gone. People join and sign in by phone number, passcode and passkey (phone_signin.go);
// the Connect grants' own OAuth server (oauth.go) stays, because it is how assistants connect, not how people sign in.

// TestB6129_NoGoogleSignInRouteRemains: the BFF serves no Google route under any setting.
func TestB6129_NoGoogleSignInRouteRemains(t *testing.T) {
	s := startDoorSuite(t, nil)
	for _, rt := range []struct{ method, path string }{{http.MethodGet, "/auth/login"}, {http.MethodGet, "/auth/callback"},
		{http.MethodPost, "/auth/mobile/session"}, {http.MethodPost, "/auth/google/move"}} {
		req, _ := http.NewRequest(rt.method, s.ts.URL+rt.path, strings.NewReader(`{}`))
		req.Header.Set("Origin", s.ts.URL)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		resp, err := s.ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s: %d, want 404", rt.method, rt.path, resp.StatusCode)
		}
	}
}

// TestB6129_AuthMeSaysNothingOfGoogle: /auth/me, signed out and signed in by phone, has no Google field for a screen
// to draw a button or the move from.
func TestB6129_AuthMeSaysNothingOfGoogle(t *testing.T) {
	s := startDoorSuite(t, nil)
	_, out := s.get(s.browser(), "", "/auth/me")
	br := s.browser()
	s.join(br, "+447700900129", "418263")
	_, in := s.get(br, "", "/auth/me")
	if in["authenticated"] != true {
		t.Fatalf("the phone join did not sign in: %v", in)
	}
	for name, me := range map[string]map[string]any{"signed out": out, "signed in": in} {
		for _, k := range []string{"google_signin", "phone_needed"} {
			if _, ok := me[k]; ok {
				t.Errorf("/auth/me %s still answers %s: %v", name, k, me)
			}
		}
	}
}

// TestB6129_BootNeedsNoGoogleClient: the BFF starts with no OIDC client id or secret; the issuer's URL is only the
// namespace existing people's identities were made under, and newAuthenticator reaches nothing.
func TestB6129_BootNeedsNoGoogleClient(t *testing.T) {
	env := validOIDCEnv()
	delete(env, "OIDC_CLIENT_ID")
	delete(env, "OIDC_CLIENT_SECRET")
	env["OIDC_ISSUER"] = "https://unreachable.invalid"
	clearBFFEnv(t, env)
	t.Setenv("OIDC_CLIENT_ID", "")
	t.Setenv("OIDC_CLIENT_SECRET", "")
	if _, err := loadConfig(); err != nil {
		t.Fatalf("loadConfig without a Google client: %v", err)
	}
}

// TestB6129_APhoneSignInReadiesTrackAndDocs: what Google's callback did at sign-in, the phone sign-in does now —
// the person's Track workspace is made, so Docs can read its roster before the first page (signInProducts).
func TestB6129_APhoneSignInReadiesTrackAndDocs(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900130", "418263")
	s.track.mu.Lock()
	before := len(s.track.bootstrap)
	s.track.mu.Unlock()
	br := s.browser()
	check, _ := s.confirm(br, "+447700900130")
	if st, out, _ := s.post(br, "", phoneSignInPath, map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK {
		t.Fatalf("sign in: %d %v", st, out)
	}
	s.track.mu.Lock()
	after := len(s.track.bootstrap)
	s.track.mu.Unlock()
	if after != before+1 {
		t.Fatalf("a phone sign-in asked Track for the person's workspace %d time(s), want once", after-before)
	}
}
