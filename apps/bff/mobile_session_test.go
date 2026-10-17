package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// B40.24: the phone app trades an ID token minted for ITS client for a Bearer session, reads the
// API with it, and signs out with it; an ID token minted for the web client is refused.
func TestPhoneSignsInWithAnIDTokenAndReadsWithBearer(t *testing.T) {
	idp := newFakeIDP(t)
	var gotAuth string
	_, ts, _ := startOIDCBFF(t, idp, &gotAuth, func(c *config) {
		c.oidcMobileClientIDs = []string{"phone-ios", "phone-android"}
	})
	phone := &http.Client{Transport: ts.Client().Transport} // no jar, no Origin: what the phone sends

	post := func(idToken string) *http.Response {
		t.Helper()
		resp, err := phone.Post(ts.URL+mobileSessionPath, "application/json",
			strings.NewReader(`{"id_token":"`+idToken+`"}`))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { resp.Body.Close() })
		return resp
	}
	call := func(method, path, bearer string) int {
		t.Helper()
		req, _ := http.NewRequest(method, ts.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		resp, err := phone.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return resp.StatusCode
	}

	idp.aud = "phone-android"
	idTok := idp.mintIDToken("")
	resp := post(idTok)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("phone ID token: status %d, body %s", resp.StatusCode, b)
	}
	if c := resp.Header.Values("Set-Cookie"); len(c) != 0 {
		t.Errorf("a phone sign-in set cookies %v; it must set none", c)
	}
	var out struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	exp, err := time.Parse(time.RFC3339, out.ExpiresAt)
	if out.Token == "" || err != nil || time.Until(exp) < 50*time.Minute {
		t.Fatalf("want a token and an RFC 3339 expiry about the session TTL out, got %+v (%v)", out, err)
	}

	if resp := post(idTok); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the same ID token a second time: status %d, want 401", resp.StatusCode)
	}

	if s := call(http.MethodGet, "/api/agents", out.Token); s != http.StatusOK {
		t.Fatalf("GET /api/agents with the Bearer token: status %d", s)
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") || strings.Contains(gotAuth, out.Token) {
		t.Errorf("Lens must get the session's workspace token, never the phone's: got %q", gotAuth)
	}
	// A write with no Origin and no cookie: the Bearer token is enough, and it ends the session.
	if s := call(http.MethodPost, "/auth/logout", out.Token); s != http.StatusNoContent {
		t.Fatalf("POST /auth/logout with the Bearer token: status %d", s)
	}
	if s := call(http.MethodGet, "/api/agents", out.Token); s != http.StatusUnauthorized {
		t.Errorf("after sign-out the token still reads: status %d", s)
	}

	idp.aud = "" // the web client's audience
	if resp := post(idp.mintIDToken("")); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("an ID token for the web client: status %d, want 401", resp.StatusCode)
	}
}

func TestPhoneSignInRefusesWhileNoPhoneClientIsSet(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, _ := startOIDCBFF(t, idp, nil, nil)
	idp.aud = "phone-ios"
	resp, err := ts.Client().Post(ts.URL+mobileSessionPath, "application/json",
		strings.NewReader(`{"id_token":"`+idp.mintIDToken("")+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("OIDC_MOBILE_CLIENT_IDS empty: status %d, want 404", resp.StatusCode)
	}
}
