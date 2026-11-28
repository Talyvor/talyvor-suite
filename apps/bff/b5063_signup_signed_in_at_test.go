package main

// b5063_signup_signed_in_at_test.go — B50.63: finishing sign-up mints the first account's token with the joining
// session's sign-in time, as opening an account does (B50.62), not as a sign-in now.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A joining session signed in 20 minutes ago finishes sign-up, and Lens is sent that sign-in time.
func TestB5063_FinishingSignUpSendsTheSessionsSignInTime(t *testing.T) {
	signedIn := time.Now().Add(-20 * time.Minute)
	l := newSignedInAtLens(t)
	cfg := config{lensBaseURL: l.srv.URL, provisionSecret: testProvisionSecret, authMode: authModeOIDC,
		oidcIssuer: "https://idp.example.com", publicBaseURL: "https://app.talyvor.com", sessionTTL: 12 * time.Hour}
	a := newApp(cfg, newAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()
	a.auth.sessions.put("sid-1", session{sub: "sub-b5063", expires: time.Now().Add(4 * time.Hour), joining: true, signedInAt: signedIn})
	req := httptest.NewRequest(http.MethodPost, "/auth/signup/account",
		strings.NewReader(`{"account_type":"personal","money_kind":"fiat","name":"Maya Lind"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "sid-1"})
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish sign-up: %d — %s", rec.Code, rec.Body.String())
	}
	wantSignedInAt(t, "finishing sign-up", l.only(t), signedIn)
}
