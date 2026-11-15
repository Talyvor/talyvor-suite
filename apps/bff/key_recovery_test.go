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

// recoveryLens records every recovery request Lens receives, with the sign-in time the BFF sent.
type recoveryLens struct {
	mu  sync.Mutex
	got []string // method, path, X-Talyvor-Signed-In-At and body
}

func (l *recoveryLens) seen() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.got...)
}

func newRecoveryApp(t *testing.T, signedInAt time.Time) (*app, *recoveryLens) {
	t.Helper()
	l := &recoveryLens{}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		l.mu.Lock()
		l.got = append(l.got, r.Method+" "+r.URL.Path+" "+r.Header.Get(signedInAtHeader)+" "+string(raw))
		l.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"recovery":null}`))
	}))
	t.Cleanup(up.Close)
	cfg := config{
		lensBaseURL: up.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: testPublicOrigin, sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	auth.sessions.put("rc-sid", session{
		sub: "u1", email: "ng@example.com", expires: time.Now().Add(time.Hour),
		workspaceID: "ws_rc", lensToken: "jwt-for-ws_rc", signedInAt: signedInAt,
	})
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, l
}

func recoveryCall(a *app, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Origin", testPublicOrigin)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "rc-sid"})
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// B55.54 — getting a key back with the recovery code reaches Lens with the session's sign-in time and only the code and
// the new key; a browser's extra fields are dropped.
func TestKeyRecoveryCarriesTheSignInTime(t *testing.T) {
	at := time.Now().Add(-2 * time.Minute).UTC()
	a, l := newRecoveryApp(t, at)
	rec := recoveryCall(a, http.MethodPost, "/api/agents/keys/recover",
		`{"code":"ABCD-EFGH","passkey":{"credential_id":"c1","name":"Mac","public_key":"pk","client_data_json":"cd","authenticator_data":"ad"},"workspace_id":"ws_other"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body)
	}
	got := l.seen()
	if len(got) != 1 {
		t.Fatalf("Lens got %d requests, want 1: %q", len(got), got)
	}
	want := "POST /v1/workspaces/ws_rc/keys/recover " + at.Format(time.RFC3339Nano) + " " +
		`{"code":"ABCD-EFGH","passkey":{"credential_id":"c1","name":"Mac","public_key":"pk","client_data_json":"cd","authenticator_data":"ad"}}`
	if got[0] != want {
		t.Fatalf("Lens got\n%s\nwant\n%s", got[0], want)
	}
}

// B55.54 — with no sign-in time, or one older than 10 minutes, the owner's own recovery calls are never relayed: the
// page is told to sign in again first.
func TestKeyRecoveryNeedsARecentSignIn(t *testing.T) {
	for name, at := range map[string]time.Time{"none": {}, "20 minutes ago": time.Now().Add(-20 * time.Minute)} {
		a, l := newRecoveryApp(t, at)
		for _, path := range []string{"/api/agents/keys/recover", "/api/agents/keys/recover/start", "/api/agents/keys/recover/complete"} {
			rec := recoveryCall(a, http.MethodPost, path, `{"code":"ABCD","passkey":{"credential_id":"c1"}}`)
			var out struct{ Error string }
			_ = json.Unmarshal(rec.Body.Bytes(), &out)
			if rec.Code != http.StatusForbidden || out.Error != "Sign in again, then try again." {
				t.Errorf("%s, %s: status %d, %q; want 403 and the sentence", name, path, rec.Code, out.Error)
			}
		}
		if got := l.seen(); len(got) != 0 {
			t.Errorf("%s: Lens got %q, want nothing", name, got)
		}
	}
}

// B55.54 — the waiting recovery is read, and cancelled, by anyone in the workspace however long ago they signed in;
// the sign-in time still goes with it.
func TestWaitingRecoveryIsReadAndCancelledWithTheSignInTime(t *testing.T) {
	at := time.Now().Add(-3 * time.Hour).UTC()
	a, l := newRecoveryApp(t, at)
	for _, c := range []struct{ method, path string }{{http.MethodGet, "/api/agents/keys/recover"}, {http.MethodPost, "/api/agents/keys/recover/cancel"}} {
		if rec := recoveryCall(a, c.method, c.path, ""); rec.Code != http.StatusOK {
			t.Fatalf("%s %s: status %d, body %s", c.method, c.path, rec.Code, rec.Body)
		}
	}
	stamp := at.Format(time.RFC3339Nano)
	want := []string{"GET /v1/workspaces/ws_rc/keys/recover " + stamp + " ", "POST /v1/workspaces/ws_rc/keys/recover/cancel " + stamp + " "}
	if got := l.seen(); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens got %q, want %q", got, want)
	}
}

// B55.54 — a new recovery code is signed by a key of the workspace: only the assertion reaches Lens.
func TestNewRecoveryCodeSendsOnlyTheAssertion(t *testing.T) {
	a, l := newRecoveryApp(t, time.Now())
	if rec := recoveryCall(a, http.MethodPost, "/api/agents/keys/recovery-code/challenge", ""); rec.Code != http.StatusOK {
		t.Fatalf("challenge: status %d", rec.Code)
	}
	rec := recoveryCall(a, http.MethodPost, "/api/agents/keys/recovery-code",
		`{"assertion":{"credential_id":"c1","client_data_json":"cd","authenticator_data":"ad","signature":"sg"},"code":"MINE"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body)
	}
	got := l.seen()
	if len(got) != 2 || !strings.HasPrefix(got[0], "POST /v1/workspaces/ws_rc/keys/recovery-code/challenge ") ||
		!strings.HasSuffix(got[1], ` {"assertion":{"credential_id":"c1","client_data_json":"cd","authenticator_data":"ad","signature":"sg"}}`) {
		t.Fatalf("Lens got %q", got)
	}
}

// B55.54 — the sign-in time survives a restart: a session restored from its seal keeps the time it was signed in,
// which is the provider's, not the seal's own (B50.49).
func TestARestoredSessionKeepsItsSignInTime(t *testing.T) {
	z := newSessionSealer(testProvisionSecret, time.Hour)
	signedIn := time.Now().Add(-time.Hour)
	sid, err := z.seal(session{sub: "u1", expires: time.Now().Add(time.Hour), workspaceID: "ws_rc", lensToken: "tok", signedInAt: signedIn})
	if err != nil {
		t.Fatal(err)
	}
	z.bootedAt = time.Now().Add(time.Second) // a later process
	s, ok := z.open(sid)
	if !ok || !s.signedInAt.Equal(signedIn) {
		t.Fatalf("restored %v with sign-in time %v, want %v from the seal", ok, s.signedInAt, signedIn)
	}
}
