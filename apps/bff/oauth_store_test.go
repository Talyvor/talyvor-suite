package main

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"testing"
)

// TestOAuthSignInsSurviveARestart is B52.1's DONE on a real Postgres: an assistant connects, the BFF restarts,
// and the same refresh token works once and rotates; a reused or revoked one is refused after a restart too.
func TestOAuthSignInsSurviveARestart(t *testing.T) {
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
	if _, err := first.pool.Exec(ctx, `TRUNCATE oauth_clients, oauth_codes, oauth_grants, oauth_tokens`); err != nil {
		t.Fatal(err)
	}
	first.close()

	// boot is one BFF process: a fresh app whose memory holds only what the table gives it.
	boot := func() (*app, *http.Cookie) {
		a, ck := oauthApp(t)
		db, err := openOAuthDB(ctx, dsn)
		if err == nil {
			err = db.load(ctx, a.oauth)
		}
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(db.close)
		a.oauth.db = db
		return a, ck
	}
	refresh := func(a *app, clientID, rt string) (int, map[string]any) {
		rec := serve(a, "POST", "/oauth/token", "", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rt}, "client_id": {clientID}}.Encode(), nil, nil)
		if rec.Code != http.StatusOK {
			return rec.Code, nil
		}
		return rec.Code, jsonOf(t, rec)
	}

	a, ck := boot()
	reg := serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["`+claudeReturn+`"],"client_name":"Claude"}`, nil, nil)
	clientID, _ := jsonOf(t, reg)["client_id"].(string)
	tok := connect(t, a, ck, clientID)
	at, rt := tok["access_token"].(string), tok["refresh_token"].(string)
	var raw, hashed int
	db := a.oauth.db
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE hash IN ($1, $2)), count(*) FILTER (WHERE hash IN ($3, $4)) FROM oauth_tokens`,
		at, rt, tokenKey(at), tokenKey(rt)).Scan(&raw, &hashed); err != nil || raw != 0 || hashed != 2 {
		t.Fatalf("tokens in the table: %d raw, %d hashed (want 0 and 2), %v", raw, hashed, err)
	}

	// Restart: the access token still reaches /mcp, Settings still lists the connection, and the refresh token rotates once.
	a, ck = boot()
	if rec := mcpWith(a, at); rec.Code != http.StatusOK {
		t.Fatalf("after a restart the access token got %d: %s", rec.Code, rec.Body.String())
	}
	if list := serve(a, "GET", "/api/connect/assistants", "", "", nil, ck); list.Code != http.StatusOK || len(jsonOf(t, list)["assistants"].([]any)) != 1 {
		t.Fatalf("after a restart Settings lists: %d %s", list.Code, list.Body.String())
	}
	code, next := refresh(a, clientID, rt)
	if code != http.StatusOK || next["refresh_token"] == rt || next["refresh_token"] == nil {
		t.Fatalf("after a restart the refresh token got %d %v", code, next)
	}

	// Restart again: the used one is a replay, refused, and it ends the connection, so its successor is refused too.
	a, _ = boot()
	if code, _ := refresh(a, clientID, rt); code != http.StatusBadRequest {
		t.Fatalf("a reused refresh token after a restart got %d", code)
	}
	a, _ = boot()
	if code, _ := refresh(a, clientID, next["refresh_token"].(string)); code != http.StatusBadRequest {
		t.Fatalf("the replayed connection's newest refresh token got %d after a restart", code)
	}

	// A connection revoked (RFC 7009) stays revoked across a restart.
	a, ck = boot()
	tok = connect(t, a, ck, clientID)
	if rec := serve(a, "POST", "/oauth/revoke", "", url.Values{"token": {tok["access_token"].(string)}}.Encode(), nil, nil); rec.Code != http.StatusOK {
		t.Fatalf("revoke: %d", rec.Code)
	}
	a, _ = boot()
	if code, _ := refresh(a, clientID, tok["refresh_token"].(string)); code != http.StatusBadRequest {
		t.Fatalf("a revoked connection's refresh token got %d after a restart", code)
	}
	// A use still in flight when the revoke landed cannot write the grant back.
	var left int
	if kept, err := a.oauth.db.touchGrant(ctx, oauthGrant{ID: "any-revoked-id"}); kept || err != nil {
		t.Fatalf("touching a revoked grant kept it: %v %v", kept, err)
	}
	if err := a.oauth.db.pool.QueryRow(ctx, `SELECT count(*) FROM oauth_grants`).Scan(&left); err != nil || left != 0 {
		t.Fatalf("%d grants left in the table after both connections ended (%v)", left, err)
	}
}
