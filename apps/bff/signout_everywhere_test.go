package main

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"
)

// TestSignOutEverywhereEndsEveryAssistant is B52.9's DONE on a real Postgres: a person with two connected
// assistants signs out everywhere, and both assistants' access and refresh tokens are refused, also after a
// restart; a browser session sealed before it is not restored by the restart; another person's assistant is kept.
func TestSignOutEverywhereEndsEveryAssistant(t *testing.T) {
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
	if _, err := first.pool.Exec(ctx, `TRUNCATE oauth_clients, oauth_codes, oauth_grants, oauth_tokens, signed_out_everywhere`); err != nil {
		t.Fatal(err)
	}
	first.close()

	boot := func() *app {
		a, _ := oauthApp(t)
		db, err := openOAuthDB(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(db.close)
		if err := a.useOAuthDB(ctx, db); err != nil {
			t.Fatal(err)
		}
		return a
	}
	ada := &http.Cookie{Name: sessionCookieName, Value: "sid-ada"}
	refreshes := func(a *app, clientID, rt string) bool {
		return serve(a, "POST", "/oauth/token", "", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rt}, "client_id": {clientID}}.Encode(), nil, nil).Code == http.StatusOK
	}

	a := boot()
	// Ada's phone, signed in before the restart below: its sealed id is what a restart would restore.
	phone, err := a.auth.sealer.seal(session{sub: "sub-ada", email: "ada@example.com", expires: time.Now().Add(time.Hour),
		workspaceID: "ws-ada", lensToken: "jwt-for-ws-ada"})
	if err != nil {
		t.Fatal(err)
	}
	clientID, _ := jsonOf(t, serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["`+claudeReturn+`"],"client_name":"Claude"}`, nil, nil))["client_id"].(string)
	claude, chatgpt := connect(t, a, ada, clientID), connect(t, a, ada, clientID)
	// Bob's assistant, written to the table as a redeemed code writes it; the restart below loads it.
	until := time.Now().Add(time.Hour)
	if err := a.oauth.db.insertGrant(ctx, oauthGrant{ID: "g-bob", ClientID: clientID, ClientName: "Claude", Scope: "wallets:read",
		Who: oauthWho{sub: "sub-bob", email: "bob@example.com", workspaceID: "ws-bob"}, Created: time.Now(), LastUsed: time.Now(),
		expires: until, endsAt: until}); err != nil {
		t.Fatal(err)
	}
	if err := a.oauth.db.saveToken(ctx, tokenKey("tlv_oat_bob"), false, oauthToken{grantID: "g-bob", expires: until}); err != nil {
		t.Fatal(err)
	}

	a = boot() // the phone's seal now predates this process, as after a deploy
	if rec := serve(a, "GET", "/api/connect/assistants", "", "", map[string]string{"Authorization": "Bearer " + phone}, nil); rec.Code != http.StatusOK {
		t.Fatalf("before signing out everywhere the phone got %d", rec.Code)
	}
	if rec := serve(a, "POST", "/auth/logout-everywhere", "https://evil.example", "", nil, ada); rec.Code != http.StatusForbidden ||
		mcpWith(a, claude["access_token"].(string)).Code != http.StatusOK {
		t.Fatalf("sign out everywhere posted from another site got %d, or ended a connection", rec.Code)
	}
	if rec := serve(a, "POST", "/auth/logout-everywhere", oauthOrigin, "", nil, ada); rec.Code != http.StatusNoContent {
		t.Fatalf("sign out everywhere: %d %s", rec.Code, rec.Body.String())
	}

	for i := 0; i < 2; i++ { // once in this process, once after a restart
		for _, tok := range []map[string]any{claude, chatgpt} {
			if rec := mcpWith(a, tok["access_token"].(string)); rec.Code != http.StatusUnauthorized {
				t.Fatalf("run %d: an access token of Ada's got %d after signing out everywhere", i, rec.Code)
			}
			if refreshes(a, clientID, tok["refresh_token"].(string)) {
				t.Fatalf("run %d: a refresh token of Ada's still works after signing out everywhere", i)
			}
		}
		for name, ck := range map[string]*http.Cookie{"this browser": ada, "the phone": {Name: sessionCookieName, Value: phone}} {
			if name == "this browser" && i > 0 {
				continue // boot signs sid-ada in afresh: an unsealed id never outlives its process anyway
			}
			if rec := serve(a, "GET", "/api/connect/assistants", "", "", nil, ck); rec.Code != http.StatusUnauthorized {
				t.Fatalf("run %d: %s is still signed in: %d", i, name, rec.Code)
			}
		}
		if rec := mcpWith(a, "tlv_oat_bob"); rec.Code != http.StatusOK {
			t.Fatalf("run %d: Bob's assistant was ended by Ada signing out everywhere: %d", i, rec.Code)
		}
		a = boot()
	}

	var ada_, bob_ int
	if err := a.oauth.db.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE sub = 'sub-ada'), count(*) FILTER (WHERE sub = 'sub-bob') FROM oauth_grants`).Scan(&ada_, &bob_); err != nil || ada_ != 0 || bob_ != 1 {
		t.Fatalf("grants left: Ada %d (want 0), Bob %d (want 1), %v", ada_, bob_, err)
	}
	// Signed in again, Ada's Connected assistants list is empty.
	seedProvisionedSession(a.auth, "sid-ada-2", "sub-ada", "ada@example.com", "ws-ada")
	if list := jsonOf(t, serve(a, "GET", "/api/connect/assistants", "", "", nil, &http.Cookie{Name: sessionCookieName, Value: "sid-ada-2"}))["assistants"].([]any); len(list) != 0 {
		t.Fatalf("Ada's list after signing out everywhere: %v", list)
	}
}
