package main

import (
	"net/http"
	"testing"
	"time"
)

// B40.8's DONE at the BFF: a connected assistant is listed for its person with its last use, nobody else sees or
// revokes it, and its own button revokes it — after which its token is refused at /mcp.
func TestConnectedAssistantsListAndRevoke(t *testing.T) {
	a, ck := oauthApp(t)
	tok := seedOAuthToken(a)
	a.oauth.grants.put("g-other", oauthGrant{ID: "g-other", ClientName: "Not Ada's", Who: oauthWho{sub: "sub-bob"},
		expires: time.Now().Add(time.Hour)})
	if rec := mcpWith(a, tok); rec.Code != http.StatusOK {
		t.Fatalf("the seeded token does not reach /mcp: %d", rec.Code)
	}

	list := jsonOf(t, serve(a, "GET", "/api/connect/assistants", "", "", nil, ck))["assistants"].([]any)
	if len(list) != 1 {
		t.Fatalf("Ada sees %d assistants, want only her own: %v", len(list), list)
	}
	got := list[0].(map[string]any)
	if got["id"] != "g-seed" || got["name"] != "Seed" {
		t.Fatalf("listed %v", got)
	}
	if used, _ := time.Parse(time.RFC3339, got["last_used_at"].(string)); time.Since(used) > time.Minute {
		t.Fatalf("last use %v is not the /mcp call just made", got["last_used_at"])
	}

	if rec := serve(a, "POST", "/api/connect/assistants/g-other/revoke", oauthOrigin, "", nil, ck); rec.Code != http.StatusNotFound {
		t.Fatalf("Ada revoking someone else's assistant got %d", rec.Code)
	}
	if _, ok := a.oauth.grants.get("g-other"); !ok {
		t.Fatal("someone else's assistant was revoked")
	}
	if rec := serve(a, "POST", "/api/connect/assistants/g-seed/revoke", oauthOrigin, "", nil, ck); rec.Code != http.StatusNoContent {
		t.Fatalf("revoke: %d %s", rec.Code, rec.Body.String())
	}
	if rec := mcpWith(a, tok); rec.Code != http.StatusUnauthorized {
		t.Fatalf("a revoked assistant's token still reaches /mcp: %d", rec.Code)
	}
	if list := jsonOf(t, serve(a, "GET", "/api/connect/assistants", "", "", nil, ck))["assistants"].([]any); len(list) != 0 {
		t.Fatalf("still listed after revoke: %v", list)
	}
}
