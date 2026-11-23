package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"sync"
	"testing"
	"time"
)

// testMailer keeps every mail, refuses the first one to each address in refuseOnce for now, and every one to each
// address in refuse for good.
type testMailer struct {
	mu         sync.Mutex
	got        []testMail
	refuseOnce map[string]bool
	refuse     map[string]bool
	tried      map[string]int
}

type testMail struct{ to, subject, body string }

func (m *testMailer) send(_ context.Context, to, subject, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tried[to]++
	if m.refuse[to] {
		return &textproto.Error{Code: 550, Msg: "no such mailbox"}
	}
	if m.refuseOnce[to] {
		delete(m.refuseOnce, to)
		return errors.New("421 try again later")
	}
	m.got = append(m.got, testMail{to, subject, body})
	return nil
}

// TestNumberMoveTellsEveryAddressAndEndsEverySession is B61.91 on a real Postgres: a move an operator made is mailed
// once to each address its person gave, and every session of theirs, web and phone, is ended; a person's own change is
// mailed in its own words and ends nothing; a move Lens hands over twice, a sweep run again and a restart send no mail
// twice; a mail the sender refused for now goes a sweep later, and one it refused for good holds up no other.
func TestNumberMoveTellsEveryAddressAndEndsEverySession(t *testing.T) {
	dsn := os.Getenv("BFF_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("BFF_TEST_DATABASE_URL is unset in CI: this test would prove nothing by skipping")
		}
		t.Skip("BFF_TEST_DATABASE_URL unset")
	}
	ctx := context.Background()
	first, err := openOAuthDB(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := first.pool.Exec(ctx, `TRUNCATE oauth_clients, oauth_codes, oauth_grants, oauth_tokens, signed_out_everywhere,
		person_emails, number_move_mails, number_moves`); err != nil {
		t.Fatal(err)
	}
	first.close()

	// Lens: Ada's move by help, then Cy's own change; the second claim hands Ada's move over again, as a Lens that
	// lost its mark would, and every claim after it hands nothing.
	moved := time.Now().Add(-time.Minute).UTC()
	claims := [][]numberMove{
		{{ID: "move-ada", PersonID: "p-ada", Identity: provisionIdentity("https://idp.example.com", "sub-ada"), MovedAt: moved, By: "operator"},
			{ID: "move-cy", PersonID: "p-cy", Identity: "person:p-cy", MovedAt: moved, By: "person"}},
		{{ID: "move-ada", PersonID: "p-ada", Identity: provisionIdentity("https://idp.example.com", "sub-ada"), MovedAt: moved, By: "operator"}},
	}
	var mu sync.Mutex
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/workspaces/ws-cy/verification/contact" {
			// Lens takes Cy's contact check, and refuses the one with an address it could not confirm.
			var in struct{ Email string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			w.Header().Set("Content-Type", "application/json")
			if in.Email == "cy.unconfirmed@example.com" {
				w.WriteHeader(http.StatusUnprocessableEntity)
				_, _ = w.Write([]byte(`{"error":"That email could not be confirmed."}`))
				return
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"check":{"level":"L1"},"verification":{"level":"L1"}}`))
			return
		}
		if r.URL.Path != "/v1/auth/phone/number-moves/claim" || r.Header.Get(provisionSecretHeader) != testProvisionSecret {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		out := []numberMove{}
		if len(claims) > 0 {
			out, claims = claims[0], claims[1:]
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"moves": out})
	}))
	t.Cleanup(lens.Close)

	mailer := &testMailer{refuseOnce: map[string]bool{"ada.work@example.com": true}, refuse: map[string]bool{"aaa-gone@example.com": true},
		tried: map[string]int{}}
	boot := func() *app {
		a, _ := oauthApp(t)
		a.cfg.lensBaseURL = lens.URL
		db, err := openOAuthDB(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(db.close)
		if err := a.useOAuthDB(ctx, db); err != nil {
			t.Fatal(err)
		}
		a.mail = mailer
		return a
	}
	a := boot()
	// The addresses Ada and Bob gave; Bob's number is not moved.
	a.rememberEmail(ctx, "sub-ada", "Ada@example.com")
	a.rememberEmail(ctx, "sub-ada", "ada.work@example.com")
	a.rememberEmail(ctx, "sub-ada", "aaa-gone@example.com") // first in line, and its mailbox is gone
	a.rememberEmail(ctx, "sub-ada", "Ada <ada@example.com>\r\nBcc: eve@example.com")
	a.rememberEmail(ctx, "sub-bob", "bob@example.com")
	// Ada on the web (sid-ada, from oauthApp) and on her lost phone, sealed as a restart would restore it; Cy and Bob
	// signed in too.
	phone, err := a.auth.sealer.seal(session{sub: "sub-ada", email: "ada@example.com", expires: time.Now().Add(time.Hour),
		workspaceID: "ws-ada", lensToken: "jwt-for-ws-ada", personID: "p-ada", phone: true})
	if err != nil {
		t.Fatal(err)
	}
	a = boot() // the phone's seal now predates this process, as after a deploy
	seedProvisionedSession(a.auth, "sid-cy", "person:p-cy", "", "ws-cy")
	seedProvisionedSession(a.auth, "sid-bob", "sub-bob", "bob@example.com", "ws-bob")
	// Cy signed in by phone, so no address came with it: hers is the one she gave for her contact check (B61.29 took
	// Google's away). The check Lens refused keeps nothing.
	cyCk := &http.Cookie{Name: sessionCookieName, Value: "sid-cy"}
	for email, code := range map[string]int{"cy@example.com": http.StatusCreated, "cy.unconfirmed@example.com": http.StatusUnprocessableEntity} {
		rec := serve(a, "POST", "/api/verification/contact", oauthOrigin, `{"email":"`+email+`","phone":"+447700900123"}`, nil, cyCk)
		if rec.Code != code {
			t.Fatalf("contact check with %s = %d %s, want %d", email, rec.Code, rec.Body.String(), code)
		}
	}
	// A restored phone session is locked (423) until its passcode: still signed in. Signed out is 401.
	signedIn := func(a *app, ck *http.Cookie) bool {
		return serve(a, "GET", "/api/connect/assistants", "", "", nil, ck).Code != http.StatusUnauthorized
	}
	ada, adaPhone := &http.Cookie{Name: sessionCookieName, Value: "sid-ada"}, &http.Cookie{Name: sessionCookieName, Value: phone}
	cy, bob := &http.Cookie{Name: sessionCookieName, Value: "sid-cy"}, &http.Cookie{Name: sessionCookieName, Value: "sid-bob"}
	if !signedIn(a, ada) || !signedIn(a, adaPhone) {
		t.Fatal("Ada was not signed in before the move")
	}

	a.tellNumberMoves(ctx) // the sender refuses Ada's work address this once
	a.tellNumberMoves(ctx) // Lens hands Ada's move over again; the work address is not due yet
	if mailer.tried["ada.work@example.com"] != 1 {
		t.Fatalf("a mail refused for now was tried again before a sweep had passed: %d tries", mailer.tried["ada.work@example.com"])
	}
	if _, err := a.oauth.db.pool.Exec(ctx, `UPDATE number_move_mails SET next_try_at = now() WHERE next_try_at > now()`); err != nil {
		t.Fatal(err)
	}
	a.tellNumberMoves(ctx) // a sweep later: the refused mail goes now
	// Ada is signed out on the web and on her lost phone. Cy changed her own number and keeps her session; Bob keeps his.
	if signedIn(a, ada) || signedIn(a, adaPhone) {
		t.Error("Ada is still signed in after help moved her number")
	}
	if !signedIn(a, cy) || !signedIn(a, bob) {
		t.Error("a person whose number help did not move was signed out")
	}
	a = boot() // a restart: nothing is sent again, and the lost phone's seal is not restored
	a.tellNumberMoves(ctx)
	if signedIn(a, adaPhone) {
		t.Error("Ada's lost phone is signed in again after a restart")
	}

	help := "Your phone number on Talyvor was changed by our help team. If this was not you, contact help now."
	own := "Your phone number on Talyvor was changed. If this was not you, contact help now."
	want := map[string]string{"ada@example.com": help, "ada.work@example.com": help, "cy@example.com": own}
	sent := map[string]int{}
	for _, m := range mailer.got {
		sent[m.to]++
		if m.body != want[m.to] || m.subject != "Your phone number on Talyvor was changed" {
			t.Errorf("%s was told %q (subject %q), want %q", m.to, m.body, m.subject, want[m.to])
		}
	}
	for to := range want {
		if sent[to] != 1 {
			t.Errorf("%s got %d mails, want exactly 1 (all: %v)", to, sent[to], mailer.got)
		}
	}
	if sent["bob@example.com"] != 0 || len(sent) != len(want) {
		t.Errorf("mails went beyond the moved people's addresses: %v", sent)
	}
	if mailer.tried["aaa-gone@example.com"] != 1 {
		t.Errorf("an address the mail server refused for good was tried %d times, want 1", mailer.tried["aaa-gone@example.com"])
	}

	var ended int
	if err := a.oauth.db.pool.QueryRow(ctx, `SELECT count(*) FROM signed_out_everywhere WHERE sub IN ('person:p-cy', 'sub-bob')`).Scan(&ended); err != nil || ended != 0 {
		t.Errorf("a person whose number help did not move was signed out everywhere: %d %v", ended, err)
	}
}
