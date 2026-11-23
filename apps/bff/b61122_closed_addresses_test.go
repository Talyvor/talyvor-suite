package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// TestClosedAccountTakesItsAddressesAndNumberMoveMails is B61.122 on a real Postgres: Talyvor closes Ada's account and
// Cy's; the next sweep of Lens's operator inbox deletes every address Ada gave and every mail her move still kept, and
// leaves her move as its id and time with no sub, once the sessions it owed are ended. Cy's address given also for her
// open account stays, with its mail and her move's sub, and so does one kept before addresses carried their account; Bob's account is open and keeps everything. A closed account's
// contact check keeps no address after.
func TestClosedAccountTakesItsAddressesAndNumberMoveMails(t *testing.T) {
	dsn := os.Getenv("BFF_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("BFF_TEST_DATABASE_URL is unset in CI: this test would prove nothing by skipping")
		}
		t.Skip("BFF_TEST_DATABASE_URL unset")
	}
	ctx := context.Background()
	moved := time.Now().Add(-time.Minute).UTC()
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/auth/phone/number-moves/claim" && r.Header.Get(provisionSecretHeader) == testProvisionSecret:
			_ = json.NewEncoder(w).Encode(map[string]any{"moves": []numberMove{
				{ID: "move-ada", PersonID: "p-ada", Identity: provisionIdentity("https://idp.example.com", "sub-ada"), MovedAt: moved, By: "operator"},
				{ID: "move-cy", PersonID: "p-cy", Identity: provisionIdentity("https://idp.example.com", "sub-cy"), MovedAt: moved, By: "person"},
				{ID: "move-bob", PersonID: "p-bob", Identity: provisionIdentity("https://idp.example.com", "sub-bob"), MovedAt: moved, By: "person"},
			}})
		case r.URL.Path == "/v1/admin/requests" && r.Header.Get("Authorization") == "Bearer "+testOperatorReadKey:
			_, _ = io.WriteString(w, `{"requests":[{"id":1,"workspace_id":"ws-ada","kind":"account_closure","state":"done"},`+
				`{"id":2,"workspace_id":"ws-cy","kind":"account_closure","state":"done"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(lens.Close)

	a, ada := oauthApp(t)
	a.cfg.lensBaseURL, a.cfg.operatorReadKey = lens.URL, testOperatorReadKey
	db, err := openOAuthDB(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.close)
	if _, err := db.pool.Exec(ctx, `TRUNCATE oauth_clients, oauth_codes, oauth_grants, oauth_tokens, signed_out_everywhere,
		person_email_accounts, person_emails, number_move_mails, number_moves`); err != nil {
		t.Fatal(err)
	}
	if err := a.useOAuthDB(ctx, db); err != nil {
		t.Fatal(err)
	}
	a.rememberEmail(ctx, "sub-ada", "ws-ada", "ada@example.com")
	a.rememberEmail(ctx, "sub-ada", "ws-ada", "ada.work@example.com")
	a.rememberEmail(ctx, "sub-cy", "ws-cy", "cy@example.com")
	a.rememberEmail(ctx, "sub-cy", "ws-cy-business", "cy@example.com") // the same address, for her account still open
	a.rememberEmail(ctx, "sub-cy", "ws-cy", "cy.old@example.com")
	a.rememberEmail(ctx, "sub-bob", "ws-bob", "bob@example.com")
	// An address Cy gave before addresses carried their account: the sweep cannot tell it is not her open account's.
	if _, err := db.pool.Exec(ctx, `INSERT INTO person_emails (sub, email, last_seen_at) VALUES ('sub-cy', 'cy.before@example.com', now())`); err != nil {
		t.Fatal(err)
	}
	// The moves are kept with their mails (no sender is set, so none goes), and Ada's sessions are not yet ended.
	if err := a.claimNumberMoves(ctx); err != nil {
		t.Fatal(err)
	}

	a.forgetClosedAccountsHelp(ctx)

	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := db.pool.QueryRow(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM person_emails WHERE sub = 'sub-ada'`); n != 0 {
		t.Errorf("the closed account kept %d of its person's addresses, want none", n)
	}
	if n := count(`SELECT count(*) FROM number_move_mails WHERE move_id = 'move-ada'`); n != 0 {
		t.Errorf("the closed account's number move kept %d mails, want none", n)
	}
	var sub string
	var ended *time.Time
	if err := db.pool.QueryRow(ctx, `SELECT sub, sessions_ended_at FROM number_moves WHERE id = 'move-ada' AND moved_at = $1`,
		moved).Scan(&sub, &ended); err != nil {
		t.Fatalf("the closed account's move is not kept as the record that it happened: %v", err)
	}
	if sub != "" || ended == nil {
		t.Errorf("the closed account's move has sub %q, sessions ended %v; want no sub, once its sessions were ended", sub, ended)
	}
	if serve(a, "GET", "/api/connect/assistants", "", "", nil, ada).Code != http.StatusUnauthorized {
		t.Error("the move help made is still owed its sign-out after the account closed")
	}
	// Cy's account is closed, her business account is not: the address she gave for both stays, with its mail.
	if n := count(`SELECT count(*) FROM person_emails WHERE sub = 'sub-cy' AND email = 'cy@example.com'`); n != 1 {
		t.Errorf("an address given also for an open account was deleted (%d rows)", n)
	}
	if n := count(`SELECT count(*) FROM person_emails WHERE sub = 'sub-cy' AND email = 'cy.old@example.com'`); n != 0 {
		t.Error("an address given only for the closed account was kept")
	}
	if n := count(`SELECT count(*) FROM person_emails WHERE sub = 'sub-cy' AND email = 'cy.before@example.com'`); n != 1 {
		t.Error("the sweep deleted an address no account was recorded for, which her open account may be told by")
	}
	if n := count(`SELECT count(*) FROM number_move_mails WHERE move_id = 'move-cy'`); n != 2 {
		t.Errorf("Cy's move kept %d mails, want the 2 to her addresses still kept", n)
	}
	if n := count(`SELECT count(*) FROM number_moves WHERE sub IN ('sub-cy', 'sub-bob')`); n != 2 {
		t.Errorf("a person with an account still open lost a move's sub (%d of 2 kept)", n)
	}
	if n := count(`SELECT count(*) FROM person_emails WHERE sub = 'sub-bob'`) + count(`SELECT count(*) FROM number_move_mails WHERE move_id = 'move-bob'`); n != 2 {
		t.Errorf("an open account lost its address or its mail (%d of 2 kept)", n)
	}
	// A closed account's contact check keeps nothing more.
	a.rememberEmail(ctx, "sub-ada", "ws-ada", "ada.new@example.com")
	if n := count(`SELECT count(*) FROM person_emails WHERE sub = 'sub-ada'`); n != 0 {
		t.Error("a closed account's contact check kept an address")
	}
}
