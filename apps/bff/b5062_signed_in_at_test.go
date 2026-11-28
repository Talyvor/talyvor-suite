package main

// b5062_signed_in_at_test.go — B50.62: a token the BFF re-mints keeps the person's real sign-in time.
//
// Lens stamps a token's auth_time at mint (talyvor-lens B50.60), and key recovery's 10-minute rule reads it. A re-mint
// through POST /v1/provision tells Lens the session's signedInAt as signed_in_at (B50.61), or the new token says the
// person signed in just now. A first sign-in sends none: Lens stamps now, which is true.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// signedInAtLens answers every provision with a token for the account asked for, and records the signed_in_at sent.
type signedInAtLens struct {
	srv  *httptest.Server
	mu   sync.Mutex
	sent []*string // nil where the call sent no signed_in_at
}

func newSignedInAtLens(t *testing.T) *signedInAtLens {
	t.Helper()
	l := &signedInAtLens{}
	l.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != provisionPath {
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		var in struct {
			Identity   string  `json:"identity"`
			AccountID  string  `json:"account_id"`
			SignedInAt *string `json:"signed_in_at"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		l.mu.Lock()
		l.sent = append(l.sent, in.SignedInAt)
		l.mu.Unlock()
		ws := in.AccountID
		if ws == "" {
			ws = deriveWorkspaceIDLikeLens(in.Identity)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"workspace_id": ws, "token": "jwt-for-" + ws,
			"expires_at": time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339)})
	}))
	t.Cleanup(l.srv.Close)
	return l
}

// only is the one provision call's signed_in_at; "" when it sent none.
func (l *signedInAtLens) only(t *testing.T) string {
	t.Helper()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.sent) != 1 {
		t.Fatalf("Lens saw %d provision calls, want 1", len(l.sent))
	}
	if l.sent[0] == nil {
		return ""
	}
	return *l.sent[0]
}

const b5062Sub = "sub-b5062"

// b5062App is an oidc-mode BFF on signedInAtLens with one session, sid-1, signed in signedIn ago, whose token expires
// at exp.
func b5062App(t *testing.T, signedIn time.Time, exp time.Time) (*app, *signedInAtLens, string) {
	t.Helper()
	l := newSignedInAtLens(t)
	cfg := config{lensBaseURL: l.srv.URL, provisionSecret: testProvisionSecret, authMode: authModeOIDC,
		oidcIssuer: "https://idp.example.com", publicBaseURL: "https://app.talyvor.com", sessionTTL: 12 * time.Hour}
	a := newApp(cfg, newAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()
	ws := deriveWorkspaceIDLikeLens(provisionIdentity(cfg.oidcIssuer, b5062Sub))
	a.auth.sessions.put("sid-1", session{sub: b5062Sub, email: "b5062@example.com", expires: time.Now().Add(4 * time.Hour),
		workspaceID: ws, lensToken: "jwt-old-for-" + ws, lensTokenExp: exp, signedInAt: signedIn})
	return a, l, ws
}

func wantSignedInAt(t *testing.T, where, got string, signedIn time.Time) {
	t.Helper()
	at, err := time.Parse(time.RFC3339, got)
	if err != nil {
		t.Fatalf("%s sent signed_in_at %q, want the session's sign-in time %s in RFC 3339", where, got, signedIn.UTC().Format(time.RFC3339))
	}
	if at.After(signedIn) || signedIn.Sub(at) >= time.Second {
		t.Fatalf("%s sent signed_in_at %s, want the session's sign-in time %s", where, got, signedIn.UTC().Format(time.RFC3339))
	}
}

// A session signed in 3 hours ago whose token ran out is re-minted with that sign-in time, not as a sign-in now.
func TestB5062_AnExpiredTokenIsReMintedWithTheSessionsSignInTime(t *testing.T) {
	signedIn := time.Now().Add(-3 * time.Hour)
	a, l, _ := b5062App(t, signedIn, time.Now().Add(-time.Minute))
	if rec := getAs(t, a, &http.Cookie{Name: sessionCookieName, Value: "sid-1"}, "/api/lxc/balance"); rec.Code != http.StatusOK {
		t.Fatalf("read with an expired token: %d — %s", rec.Code, rec.Body.String())
	}
	wantSignedInAt(t, "the re-mint", l.only(t), signedIn)
}

// Switching account mints the other account's token for the same session, so it keeps the same sign-in time.
func TestB5062_SwitchingAccountKeepsTheSessionsSignInTime(t *testing.T) {
	signedIn := time.Now().Add(-3 * time.Hour)
	a, l, _ := b5062App(t, signedIn, time.Now().Add(6*time.Hour))
	req := httptest.NewRequest(http.MethodPost, "/api/accounts/switch", strings.NewReader(`{"account_id":"u-other-account"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "sid-1"})
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("switch: %d — %s", rec.Code, rec.Body.String())
	}
	wantSignedInAt(t, "the switch", l.only(t), signedIn)
}

// An assistant's grant re-mints with the sign-in time of the session it was made in.
func TestB5062_AConnectGrantReMintsWithTheSignInTimeItWasMadeIn(t *testing.T) {
	signedIn := time.Now().Add(-3 * time.Hour)
	a, l, ws := b5062App(t, signedIn, time.Now().Add(6*time.Hour))
	g := oauthGrant{ID: "g-b5062", Created: time.Now().Add(-time.Hour), Who: oauthWho{sub: b5062Sub, workspaceID: ws, signedInAt: signedIn}}
	if got, ok := a.mcpTenant(t.Context(), g); !ok || got.workspaceID != ws {
		t.Fatalf("the grant acts as %+v (ok %t), want %s", got, ok, ws)
	}
	wantSignedInAt(t, "the grant's re-mint", l.only(t), signedIn)
}

// A first sign-in sends none, so Lens stamps now.
func TestB5062_AFirstSignInSendsNoSignInTime(t *testing.T) {
	a, l, _ := b5062App(t, time.Now(), time.Now().Add(6*time.Hour))
	if _, err := a.provisionForSession(t.Context(), provisionIdentity(a.cfg.oidcIssuer, b5062Sub)); err != nil {
		t.Fatal(err)
	}
	if got := l.only(t); got != "" {
		t.Fatalf("a first sign-in sent signed_in_at %q, want none", got)
	}
}
