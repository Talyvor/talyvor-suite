package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestDeleteAccountEndsEveryAssistant is B52.38's DONE on a real Postgres: a person with two connected assistants
// deletes their account in Settings, Lens is asked to delete it for their identity, and both assistants' access and
// refresh tokens are refused, also after a restart; another person's assistant is kept. A wrong email typed back, or
// a deletion Lens refuses, deletes nothing and ends nothing.
func TestDeleteAccountEndsEveryAssistant(t *testing.T) {
	dsn := os.Getenv("BFF_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("BFF_TEST_DATABASE_URL is unset in CI: this test would prove nothing by skipping")
		}
		t.Skip("BFF_TEST_DATABASE_URL unset")
	}
	// Without the table a restart would bring the connections back, so the deletion is not even asked of Lens.
	if noDB, ck := oauthApp(t); serve(noDB, "POST", "/auth/account/delete", oauthOrigin, `{"confirm":"ada@example.com"}`, nil, ck).Code != http.StatusServiceUnavailable {
		t.Fatal("deleting an account without a database was not refused")
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

	// Lens's POST /v1/account/delete: it refuses while refuse is set, as it does while the account holds money.
	var mu sync.Mutex
	var asked []string
	refuse := true
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/account/delete" || r.Header.Get(provisionSecretHeader) != testProvisionSecret {
			http.NotFound(w, r)
			return
		}
		var in struct{ Identity string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		mu.Lock()
		defer mu.Unlock()
		asked = append(asked, in.Identity)
		w.Header().Set("Content-Type", "application/json")
		if refuse {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"your account still holds money, so it can't be deleted yet. Move the money out and finish or cancel what is open, then try again."}`))
			return
		}
		_, _ = w.Write([]byte(`{"deleted":true,"workspace_id":"ws-ada","workspace_ids":["ws-ada"]}`))
	}))
	t.Cleanup(lens.Close)

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
		return a
	}
	ada := &http.Cookie{Name: sessionCookieName, Value: "sid-ada"}
	refreshes := func(a *app, clientID, rt string) bool {
		return serve(a, "POST", "/oauth/token", "", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rt}, "client_id": {clientID}}.Encode(), nil, nil).Code == http.StatusOK
	}
	del := func(a *app, origin, typed string) *httptest.ResponseRecorder {
		return serve(a, "POST", "/auth/account/delete", origin, `{"confirm":"`+typed+`"}`, nil, ada)
	}

	a := boot()
	clientID, _ := jsonOf(t, serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["`+claudeReturn+`"],"client_name":"Claude"}`, nil, nil))["client_id"].(string)
	claude, chatgpt := connect(t, a, ada, clientID), connect(t, a, ada, clientID)
	until := time.Now().Add(time.Hour)
	if _, err := a.oauth.db.insertGrant(ctx, oauthGrant{ID: "g-bob", ClientID: clientID, ClientName: "Claude", Scope: "wallets:read",
		Who: oauthWho{sub: "sub-bob", email: "bob@example.com", workspaceID: "ws-bob"}, Created: time.Now(), LastUsed: time.Now(),
		expires: until, endsAt: until}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := a.oauth.db.saveToken(ctx, tokenKey("tlv_oat_bob"), false, oauthToken{grantID: "g-bob", expires: until}); err != nil {
		t.Fatal(err)
	}
	a = boot() // loads Bob's assistant from the table

	// Nothing is asked of Lens from another site, nor with the wrong email typed back.
	if rec := del(a, "https://evil.example", "ada@example.com"); rec.Code != http.StatusForbidden {
		t.Fatalf("a deletion posted from another site got %d", rec.Code)
	}
	if rec := del(a, oauthOrigin, "bob@example.com"); rec.Code != http.StatusBadRequest {
		t.Fatalf("a deletion with the wrong email typed back got %d", rec.Code)
	}
	if len(asked) != 0 {
		t.Fatalf("Lens was asked to delete an account %d times before the email was typed back", len(asked))
	}
	// Lens refuses: its words reach the person, and every connection is kept.
	if rec := del(a, oauthOrigin, " Ada@Example.com "); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "still holds money") {
		t.Fatalf("a deletion Lens refused got %d %s", rec.Code, rec.Body.String())
	}
	if mcpWith(a, claude["access_token"].(string)).Code != http.StatusOK {
		t.Fatal("a deletion Lens refused ended a connection")
	}

	mu.Lock()
	refuse = false
	mu.Unlock()
	if rec := del(a, oauthOrigin, "ada@example.com"); rec.Code != http.StatusNoContent {
		t.Fatalf("deleting the account: %d %s", rec.Code, rec.Body.String())
	}
	if want := provisionIdentity("https://idp.example.com", "sub-ada"); len(asked) != 2 || asked[1] != want {
		t.Fatalf("Lens was asked to delete %q, want Ada's identity", asked)
	}

	for i := 0; i < 2; i++ { // once in this process, once after a restart
		for _, tok := range []map[string]any{claude, chatgpt} {
			if rec := mcpWith(a, tok["access_token"].(string)); rec.Code != http.StatusUnauthorized {
				t.Fatalf("run %d: an access token of Ada's got %d after deleting her account", i, rec.Code)
			}
			if refreshes(a, clientID, tok["refresh_token"].(string)) {
				t.Fatalf("run %d: a refresh token of Ada's still works after deleting her account", i)
			}
		}
		if i == 0 {
			if rec := serve(a, "GET", "/api/connect/assistants", "", "", nil, ada); rec.Code != http.StatusUnauthorized {
				t.Fatalf("this browser is still signed in after deleting the account: %d", rec.Code)
			}
		}
		if rec := mcpWith(a, "tlv_oat_bob"); rec.Code != http.StatusOK {
			t.Fatalf("run %d: Bob's assistant was ended by Ada deleting her account: %d", i, rec.Code)
		}
		a = boot()
	}
	var ada_, bob_ int
	if err := a.oauth.db.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE sub = 'sub-ada'), count(*) FILTER (WHERE sub = 'sub-bob') FROM oauth_grants`).Scan(&ada_, &bob_); err != nil || ada_ != 0 || bob_ != 1 {
		t.Fatalf("grants left: Ada %d (want 0), Bob %d (want 1), %v", ada_, bob_, err)
	}
}
