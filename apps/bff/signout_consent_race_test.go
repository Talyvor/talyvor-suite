package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

// TestConsentRacingSignOutEverywhereMakesNoConnection is B54.14's DONE on a real Postgres: Ada allows an assistant
// while she signs out everywhere, and the code her consent was given is refused, whichever of the two gets her
// lock first, and also after a restart: a sign-out queued for her lock before the consent, and one that is ending
// her sign-ins in the table when the consent finds her session still there in memory.
func TestConsentRacingSignOutEverywhereMakesNoConnection(t *testing.T) {
	dsn := os.Getenv("BFF_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("BFF_TEST_DATABASE_URL is unset in CI: this test would prove nothing by skipping")
		}
		t.Skip("BFF_TEST_DATABASE_URL unset")
	}
	ctx := context.Background()
	a, ada := oauthApp(t)
	db, err := openOAuthDB(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.close)
	if _, err := db.pool.Exec(ctx, `TRUNCATE oauth_clients, oauth_codes, oauth_grants, oauth_tokens, signed_out_everywhere`); err != nil {
		t.Fatal(err)
	}
	if err := a.useOAuthDB(ctx, db); err != nil {
		t.Fatal(err)
	}

	clientID, _ := jsonOf(t, serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["`+claudeReturn+`"],"client_name":"Claude"}`, nil, nil))["client_id"].(string)
	verifier := "a-verifier-of-at-least-forty-three-characters-0123456789"
	sum := sha256.Sum256([]byte(verifier))
	authorize := "/oauth/authorize?" + url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {claudeReturn},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"},
		"state": {"st-1"}, "scope": {"wallets:read"}, "resource": {oauthOrigin + "/mcp"}}.Encode()
	ask := func() string {
		body := serve(a, "GET", authorize, "", "", nil, ada).Body.String()
		parts := strings.SplitN(body, `name="consent" value="`, 2)
		if len(parts) != 2 {
			t.Fatalf("no consent screen: %s", body)
		}
		return strings.SplitN(parts[1], `"`, 2)[0]
	}
	answer := func(consent string) chan *httptest.ResponseRecorder {
		out := make(chan *httptest.ResponseRecorder, 1)
		go func() {
			out <- serve(a, "POST", "/oauth/authorize", oauthOrigin, "consent="+consent+"&decision=allow", nil, ada)
		}()
		return out
	}
	signOut := func() chan *httptest.ResponseRecorder {
		out := make(chan *httptest.ResponseRecorder, 1)
		go func() { out <- serve(a, "POST", "/auth/logout-everywhere", oauthOrigin, "", nil, ada) }()
		return out
	}
	// redeem is the token endpoint's answer to the code the consent sent back; 0 when it sent none.
	redeem := func(a *app, allow *httptest.ResponseRecorder) int {
		back, _ := url.Parse(allow.Header().Get("Location"))
		code := back.Query().Get("code")
		if code == "" {
			return 0
		}
		return serve(a, "POST", "/oauth/token", "", url.Values{"grant_type": {"authorization_code"}, "code": {code},
			"redirect_uri": {claudeReturn}, "client_id": {clientID}, "resource": {oauthOrigin + "/mcp"}, "code_verifier": {verifier}}.Encode(), nil, nil).Code
	}

	// The test's own connection holds a lock while the two requests queue behind it.
	held, err := db.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Release()
	lock := func(fn, key string) {
		if _, err := held.Exec(ctx, `SELECT `+fn+`(hashtextextended($1, 0))`, key); err != nil {
			t.Fatal(err)
		}
	}
	waiting := func(key string) (n int) {
		if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
			AND ((classid::bigint << 32) | objid::bigint) = hashtextextended($1, 0)`, key).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	until := func(what string, done func() bool) {
		for deadline := time.Now().Add(10 * time.Second); !done(); time.Sleep(10 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting until %s", what)
			}
		}
	}
	const person = "oauth person sub-ada"

	// Uncontested, a consent's code becomes a connection: what the refusals below are refusals of.
	if code := redeem(a, <-answer(ask())); code != http.StatusOK {
		t.Fatalf("an uncontested consent's code got %d", code)
	}

	// 1. The sign-out has Ada's lock first; the consent, its session still found, waits behind it.
	consent := ask()
	lock("pg_advisory_lock", person)
	out := signOut()
	until("the sign-out waits for Ada's lock", func() bool { return waiting(person) == 1 })
	in := answer(consent)
	until("the consent is answered or waits behind the sign-out", func() bool { return len(in) == 1 || waiting(person) == 2 })
	lock("pg_advisory_unlock", person)
	if rec := <-out; rec.Code != http.StatusNoContent {
		t.Fatalf("sign out everywhere: %d %s", rec.Code, rec.Body.String())
	}
	if code := redeem(a, <-in); code == http.StatusOK {
		t.Fatal("a consent answered while Ada signed out everywhere became a connection (the sign-out had her lock first)")
	}

	// 2. The sign-out is ending Ada's sign-ins in the table when the consent finds her session, still there in
	// memory, and answers it.
	seedProvisionedSession(a.auth, "sid-ada", "sub-ada", "ada@example.com", "ws-ada")
	consent = ask()
	const hold = "b54.14 a sign-out is being written"
	if _, err := db.pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION b5414_hold() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('`+hold+`', 0)); RETURN NEW; END $$;
		CREATE OR REPLACE TRIGGER b5414_hold BEFORE INSERT OR UPDATE ON signed_out_everywhere FOR EACH ROW EXECUTE FUNCTION b5414_hold();`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS b5414_hold ON signed_out_everywhere; DROP FUNCTION IF EXISTS b5414_hold()`)
	})
	lock("pg_advisory_lock", hold)
	out = signOut()
	until("the sign-out is being written", func() bool { return waiting(hold) == 1 })
	in = answer(consent)
	until("the consent is answered or waits for Ada's lock", func() bool { return len(in) == 1 || waiting(person) == 1 })
	lock("pg_advisory_unlock", hold)
	if rec := <-out; rec.Code != http.StatusNoContent {
		t.Fatalf("sign out everywhere: %d %s", rec.Code, rec.Body.String())
	}
	allow := <-in
	if code := redeem(a, allow); code == http.StatusOK {
		t.Fatal("a consent answered while Ada signed out everywhere became a connection (the sign-out was being written)")
	}
	// A restart reads back every code the table kept.
	b, _ := oauthApp(t)
	again, err := openOAuthDB(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(again.close)
	if err := b.useOAuthDB(ctx, again); err != nil {
		t.Fatal(err)
	}
	if code := redeem(b, allow); code == http.StatusOK {
		t.Fatal("after a restart, a consent answered while Ada signed out everywhere became a connection")
	}

	var grants, codes int
	if err := db.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM oauth_grants WHERE sub = 'sub-ada'), (SELECT count(*) FROM oauth_codes WHERE sub = 'sub-ada')`).Scan(&grants, &codes); err != nil || grants != 0 || codes != 0 {
		t.Fatalf("left for Ada after signing out everywhere: %d grants, %d codes (want 0 and 0), %v", grants, codes, err)
	}
}
