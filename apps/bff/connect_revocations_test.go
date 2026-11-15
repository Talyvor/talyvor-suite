package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

// fakeLensRevocations is Lens's POST /v1/auth/connect-revocations (B54.13): it records what it was told, or answers 503
// while down.
type fakeLensRevocations struct {
	mu       sync.Mutex
	down     bool
	tries    int
	recorded []map[string]string
}

func (f *fakeLensRevocations) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Method+" "+r.URL.Path != "POST /v1/auth/connect-revocations" || r.Header.Get("Authorization") != "Bearer mint-key" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	f.tries++
	if f.down {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	raw, _ := io.ReadAll(r.Body)
	var in map[string]string
	_ = json.Unmarshal(raw, &in)
	f.recorded = append(f.recorded, in)
	w.WriteHeader(http.StatusCreated)
}

func (f *fakeLensRevocations) seen() (tries int, recorded []map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.tries, append([]map[string]string(nil), f.recorded...)
}

// waitFor polls until ok or five seconds pass: the BFF tells Lens after the disconnect has answered.
func waitFor(ok func() bool) bool {
	for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(20 * time.Millisecond) {
		if ok() {
			return true
		}
	}
	return ok()
}

// TestConnectEndingsReachLens is B54.21's DONE on a real Postgres: disconnecting one assistant in Settings tells Lens to
// end that assistant's Connect tokens, and signing out everywhere tells it to end every one of the person's. While Lens
// does not answer, the disconnect still happens, and what Lens is owed is told again, also after a restart, until
// Lens records it.
func TestConnectEndingsReachLens(t *testing.T) {
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
	if _, err := first.pool.Exec(ctx, `TRUNCATE oauth_clients, oauth_codes, oauth_grants, oauth_tokens, signed_out_everywhere, connect_revocations_owed`); err != nil {
		t.Fatal(err)
	}
	first.close()

	lens := &fakeLensRevocations{down: true}
	srv := httptest.NewServer(lens)
	t.Cleanup(srv.Close)
	boot := func() *app {
		a, _ := oauthApp(t)
		a.cfg.lensBaseURL, a.cfg.lensConnectMintKey = srv.URL, "mint-key"
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
	register := func(a *app, name string) string {
		id, _ := jsonOf(t, serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["`+claudeReturn+`"],"client_name":"`+name+`"}`, nil, nil))["client_id"].(string)
		return id
	}

	a := boot()
	claudeID, chatgptID := register(a, "Claude"), register(a, "ChatGPT")
	connect(t, a, ada, claudeID)
	chatgpt := connect(t, a, ada, chatgptID)
	var claudeGrant string
	for _, g := range a.oauth.grants.matching(func(g oauthGrant) bool { return g.ClientID == claudeID }) {
		claudeGrant = g.ID
	}

	// Lens is down: the disconnect still happens, and Lens was asked.
	if rec := serve(a, "POST", "/api/connect/assistants/"+claudeGrant+"/revoke", oauthOrigin, "", nil, ada); rec.Code != http.StatusNoContent {
		t.Fatalf("disconnecting Claude while Lens is down: %d %s", rec.Code, rec.Body.String())
	}
	if !waitFor(func() bool { n, _ := lens.seen(); return n > 0 }) {
		t.Fatal("disconnecting Claude never told Lens")
	}
	if _, rec := lens.seen(); len(rec) != 0 {
		t.Fatalf("Lens was down and yet recorded %v", rec)
	}

	// Lens is back, and this BFF restarted meanwhile: what Lens is owed is told again from the table.
	lens.mu.Lock()
	lens.down = false
	lens.mu.Unlock()
	a = boot()
	a.tellLensConnectionsEnded(ctx)
	if _, rec := lens.seen(); len(rec) != 1 || rec[0]["user_id"] != "ws-ada" || rec[0]["client_id"] != claudeID {
		t.Fatalf("after the restart Lens recorded %v, want Claude's disconnect for ws-ada", rec)
	}
	a.tellLensConnectionsEnded(ctx)
	if _, rec := lens.seen(); len(rec) != 1 {
		t.Fatalf("a disconnect Lens recorded was told again: %v", rec)
	}
	if mcpWith(a, chatgpt["access_token"].(string)).Code != http.StatusOK {
		t.Fatal("disconnecting Claude ended ChatGPT too")
	}

	// Signing out everywhere tells Lens to end every assistant of Ada's: no client id.
	if rec := serve(a, "POST", "/auth/logout-everywhere", oauthOrigin, "", nil, ada); rec.Code != http.StatusNoContent {
		t.Fatalf("sign out everywhere: %d %s", rec.Code, rec.Body.String())
	}
	if !waitFor(func() bool { _, rec := lens.seen(); return len(rec) == 2 }) {
		_, rec := lens.seen()
		t.Fatalf("signing out everywhere did not reach Lens: %v", rec)
	}
	if _, rec := lens.seen(); rec[1]["user_id"] != "ws-ada" || rec[1]["client_id"] != "" {
		t.Fatalf("signing out everywhere told Lens %v, want every assistant of ws-ada", rec[1])
	}
	var owed int
	if err := a.oauth.db.pool.QueryRow(ctx, `SELECT count(*) FROM connect_revocations_owed`).Scan(&owed); err != nil || owed != 0 {
		t.Fatalf("%d revocations still owed to Lens after it recorded them all (%v)", owed, err)
	}
}
