package main

// B58.9: an email counts only when the id_token says email_verified is true. Absent means
// unverified, with sign-up open and on the allowlist alike, because the BFF hands that address to
// Track and Docs as X-User-Email and they decide workspace membership by it.

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAuthorizeIdentity_AnEmailCountsOnlyWhenVerified(t *testing.T) {
	open := []string{"*"}
	listed := []string{"ng@example.com"}
	for _, tc := range []struct {
		name     string
		allowed  []string
		email    string
		verified *bool
		want     bool
	}{
		{"sign-up open, email_verified false", open, "ng@example.com", boolPtr(false), false},
		{"sign-up open, email_verified absent", open, "ng@example.com", nil, false},
		{"sign-up open, email_verified true (Google)", open, "ng@example.com", boolPtr(true), true},
		{"sign-up open, no email claim at all", open, "", nil, true},
		{"allowlist, listed, email_verified absent", listed, "ng@example.com", nil, false},
		{"allowlist, listed, email_verified false", listed, "ng@example.com", boolPtr(false), false},
		{"allowlist, listed, email_verified true (Google)", listed, "ng@example.com", boolPtr(true), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := authorizeIdentity(tc.allowed, "sub-1", tc.email, tc.verified); ok != tc.want {
				t.Errorf("authorizeIdentity = %v, want %v", ok, tc.want)
			}
		})
	}
}

// The browser is refused with the one sentence and gets no session, whether sign-up is open or the
// address is on the list.
func TestSignIn_RefusesAnUnverifiedEmailWithOneSentence(t *testing.T) {
	for _, tc := range []struct {
		name     string
		allowed  []string
		verified *bool
	}{
		{"sign-up open, email_verified false", []string{"*"}, boolPtr(false)},
		{"allowlist, listed, email_verified absent", []string{"ng@example.com"}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			idp := newFakeIDP(t)
			idp.email, idp.emailVerified = "ng@example.com", tc.verified
			_, ts, client := startOIDCBFF(t, idp, nil, func(c *config) { c.allowedEmails = tc.allowed })
			h := loginHops(t, ts, client, "/")
			if h.callback.StatusCode != http.StatusForbidden {
				t.Fatalf("unverified email: got %d, want 403", h.callback.StatusCode)
			}
			if !strings.Contains(h.cbBody, unverifiedEmailSentence) {
				t.Errorf("the refusal does not say why in its one sentence; body=%s", h.cbBody)
			}
			if cookieNamed(h.callback, sessionCookieName) != nil {
				t.Fatal("an unverified email was given a session")
			}
			if resp, _ := doReq(t, client, http.MethodGet, ts.URL+"/api/context"); resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("/api after the refusal: got %d, want 401", resp.StatusCode)
			}
		})
	}
}

func TestPhoneSignIn_RefusesAnUnverifiedEmail(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, _ := startOIDCBFF(t, idp, nil, func(c *config) {
		c.allowedEmails = []string{"*"}
		c.oidcMobileClientIDs = []string{"phone-ios"}
	})
	idp.aud, idp.emailVerified = "phone-ios", boolPtr(false)
	resp, err := ts.Client().Post(ts.URL+mobileSessionPath, "application/json",
		strings.NewReader(`{"id_token":"`+idp.mintIDToken("")+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(string(body), unverifiedEmailSentence) {
		t.Fatalf("phone, unverified email: status %d, body %s; want 403 with the sentence", resp.StatusCode, body)
	}
}
