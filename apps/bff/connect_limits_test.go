package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func from(ip string) map[string]string { return map[string]string{"X-Forwarded-For": ip} }

func wantLimited(t *testing.T, what string, rec *httptest.ResponseRecorder, atMost time.Duration) {
	t.Helper()
	secs, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if rec.Code != http.StatusTooManyRequests || err != nil || secs < 1 || time.Duration(secs)*time.Second > atMost {
		t.Fatalf("%s over its limit: %d Retry-After %q (want 429 and 1..%v)", what, rec.Code, rec.Header().Get("Retry-After"), atMost)
	}
}

// TestConnectRateLimitsPerIP is B52.3: each Connect endpoint answers 429 with Retry-After past its per-IP limit, and
// only to that address. The register limit is the DCR cap: one address holds at most that many unused clients.
func TestConnectRateLimitsPerIP(t *testing.T) {
	for _, env := range []string{"BFF_CONNECT_REGISTER_PER_IP_HOUR", "BFF_CONNECT_AUTHORIZE_PER_IP_MINUTE",
		"BFF_CONNECT_TOKEN_PER_IP_MINUTE", "BFF_CONNECT_MCP_PER_IP_MINUTE"} {
		t.Setenv(env, "2")
	}
	a, _ := oauthApp(t)
	reg := `{"redirect_uris":["` + claudeReturn + `"],"client_name":"Claude"}`
	for _, c := range []struct {
		what, method, path, body string
		window                   time.Duration
	}{
		{"register", "POST", "/oauth/register", reg, time.Hour},
		{"authorize", "GET", "/oauth/authorize?client_id=x", "", time.Minute},
		{"token", "POST", "/oauth/token", "grant_type=refresh_token&refresh_token=nope", time.Minute},
		{"mcp", "POST", "/mcp", `{"jsonrpc":"2.0","id":1,"method":"ping"}`, time.Minute},
	} {
		for i := range 2 {
			if rec := serve(a, c.method, c.path, "", c.body, from("203.0.113.7"), nil); rec.Code == http.StatusTooManyRequests {
				t.Fatalf("%s call %d of 2 was limited", c.what, i+1)
			}
		}
		wantLimited(t, c.what, serve(a, c.method, c.path, "", c.body, from("203.0.113.7"), nil), c.window)
		if rec := serve(a, c.method, c.path, "", c.body, from("198.51.100.9"), nil); rec.Code == http.StatusTooManyRequests {
			t.Fatalf("%s from another address was limited", c.what)
		}
	}
	if n := a.oauth.clients.size(); n != 3 {
		t.Fatalf("%d clients registered, want 3: two from the limited address and one from the other", n)
	}
}

// TestConnectRateLimitsPerConnection is B52.3: one connection is limited on /mcp and on refreshing its tokens,
// whatever address it calls from, and across a rotation of its refresh token.
func TestConnectRateLimitsPerConnection(t *testing.T) {
	t.Setenv("BFF_CONNECT_MCP_PER_CONNECTION_MINUTE", "2")
	t.Setenv("BFF_CONNECT_TOKEN_PER_CONNECTION_MINUTE", "1")
	a, _ := oauthApp(t)
	at := seedOAuthToken(a)
	ping := `{"jsonrpc":"2.0","id":1,"method":"ping"}`
	bearer := func(ip string) map[string]string {
		return map[string]string{"Authorization": "Bearer " + at, "X-Forwarded-For": ip}
	}
	for i, ip := range []string{"203.0.113.1", "203.0.113.2"} {
		if rec := serve(a, "POST", "/mcp", "", ping, bearer(ip), nil); rec.Code != http.StatusOK {
			t.Fatalf("mcp call %d of 2: %d %s", i+1, rec.Code, rec.Body.String())
		}
	}
	wantLimited(t, "mcp per connection", serve(a, "POST", "/mcp", "", ping, bearer("203.0.113.3"), nil), time.Minute)

	a.oauth.refresh.put(tokenKey("tlv_ort_seed"), oauthToken{grantID: "g-seed", expires: time.Now().Add(time.Hour)})
	refresh := func(rt, ip string) *httptest.ResponseRecorder {
		return serve(a, "POST", "/oauth/token", "", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rt}, "client_id": {"c-seed"}}.Encode(), from(ip), nil)
	}
	first := refresh("tlv_ort_seed", "203.0.113.4")
	if first.Code != http.StatusOK {
		t.Fatalf("first refresh: %d %s", first.Code, first.Body.String())
	}
	next, _ := jsonOf(t, first)["refresh_token"].(string)
	wantLimited(t, "refresh per connection", refresh(next, "203.0.113.5"), time.Minute)
	if _, ok := a.oauth.refresh.get(tokenKey(next)); !ok {
		t.Fatal("a limited refresh spent the refresh token")
	}
}

// TestConnectAuditTrail is B52.3's audit on a real Postgres: every tool call is one row (connection, assistant,
// tool, arguments by hash, result, time), Settings lists them under the connection, and a registration nobody
// signed in with leaves the table when it expires.
func TestConnectAuditTrail(t *testing.T) {
	dsn := os.Getenv("BFF_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("BFF_TEST_DATABASE_URL is unset in CI: this test would prove nothing by skipping")
		}
		t.Skip("BFF_TEST_DATABASE_URL unset")
	}
	ctx := context.Background()
	db, err := openOAuthDB(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.close)
	if _, err := db.pool.Exec(ctx, `TRUNCATE oauth_clients, oauth_codes, oauth_grants, oauth_tokens, oauth_tool_calls`); err != nil {
		t.Fatal(err)
	}
	a, ck := oauthApp(t)
	a.oauth.db = db
	at := seedOAuthToken(a)
	if g, _ := a.oauth.grants.get("g-seed"); func() error { _, err := db.insertGrant(ctx, g, time.Now()); return err }() != nil {
		t.Fatal("the seeded connection could not be saved")
	}
	call := func(body string) {
		t.Helper()
		if rec := serve(a, "POST", "/mcp", "", body, map[string]string{"Authorization": "Bearer " + at}, nil); rec.Code != http.StatusOK {
			t.Fatalf("tools/call: %d %s", rec.Code, rec.Body.String())
		}
	}
	args := `{"secret_note":"never stored"}`
	call(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_balances","arguments":` + args + `}}`)
	call(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"no_such_tool"}}`)
	call(`{"jsonrpc":"2.0","id":3,"method":"ping"}`)

	var n int
	var stored string
	if err := db.pool.QueryRow(ctx, `SELECT count(*), string_agg(grant_id||client_name||tool||args_sha256||result, ',') FROM oauth_tool_calls`).Scan(&n, &stored); err != nil || n != 2 {
		t.Fatalf("%d audit rows, want one per tool call (2): %v", n, err)
	}
	if strings.Contains(stored, "never stored") {
		t.Fatal("the audit trail holds a tool's arguments")
	}

	list := serve(a, "GET", "/api/connect/assistants", "", "", nil, ck)
	got := jsonOf(t, list)["assistants"].([]any)
	if list.Code != http.StatusOK || len(got) != 1 {
		t.Fatalf("Settings: %d %s", list.Code, list.Body.String())
	}
	calls := got[0].(map[string]any)["calls"].([]any)
	if len(calls) != 2 {
		t.Fatalf("Settings lists %d calls, want 2: %s", len(calls), list.Body.String())
	}
	newest, oldest := calls[0].(map[string]any), calls[1].(map[string]any)
	if newest["tool"] != "no_such_tool" || newest["result"] != "failed" || oldest["tool"] != "get_balances" ||
		oldest["result"] != "refused" || oldest["args_sha256"] != tokenKey(args) || oldest["at"] == "" {
		t.Fatalf("Settings shows the calls as %v", calls)
	}

	// A registration nobody signed in with is gone from the table once its hour is up.
	if _, err := db.pool.Exec(ctx, `INSERT INTO oauth_clients (id, name, redirect_uris, expires_at) VALUES ('tlv_oc_stale', 'x', '{}', now() - interval '1 second')`); err != nil {
		t.Fatal(err)
	}
	if rec := serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["`+claudeReturn+`"]}`, nil, nil); rec.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", rec.Code, rec.Body.String())
	}
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM oauth_clients WHERE id = 'tlv_oc_stale'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("an expired unused client is still in the table (%d, %v)", n, err)
	}
}

// TestConnectAuditTrailInMemory is B17.357: a BFF with no database keeps each connection's latest calls in memory, as
// it keeps the connection itself, so Settings still lists what an assistant did.
func TestConnectAuditTrailInMemory(t *testing.T) {
	a, ck := oauthApp(t)
	at := seedOAuthToken(a)
	call := func(body string) {
		t.Helper()
		if rec := serve(a, "POST", "/mcp", "", body, map[string]string{"Authorization": "Bearer " + at}, nil); rec.Code != http.StatusOK {
			t.Fatalf("tools/call: %d %s", rec.Code, rec.Body.String())
		}
	}
	for i := 0; i <= connectedCallsShown; i++ {
		call(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"no_such_tool"}}`)
	}
	call(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_balances","arguments":{}}}`)

	list := serve(a, "GET", "/api/connect/assistants", "", "", nil, ck)
	got := jsonOf(t, list)["assistants"].([]any)
	if list.Code != http.StatusOK || len(got) != 1 {
		t.Fatalf("Settings: %d %s", list.Code, list.Body.String())
	}
	calls, _ := got[0].(map[string]any)["calls"].([]any)
	if len(calls) != connectedCallsShown || calls[0].(map[string]any)["tool"] != "get_balances" {
		t.Fatalf("Settings lists %d calls, want the latest %d newest first: %s", len(calls), connectedCallsShown, list.Body.String())
	}
}
