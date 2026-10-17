package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const (
	oauthOrigin  = "https://app.talyvor.test"
	claudeReturn = "https://claude.ai/api/mcp/auth_callback"
)

func oauthApp(t *testing.T) (*app, *http.Cookie) {
	t.Helper()
	cfg := config{lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com", publicBaseURL: oauthOrigin, sessionTTL: time.Hour}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "sid-ada", "sub-ada", "ada@example.com", "ws-ada")
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, &http.Cookie{Name: sessionCookieName, Value: "sid-ada"}
}

func serve(a *app, method, target, origin, body string, h map[string]string, ck *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if strings.HasPrefix(body, "{") {
		req.Header.Set("Content-Type", "application/json")
	} else if body != "" {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	for k, v := range h {
		req.Header.Set(k, v)
	}
	if ck != nil {
		req.AddCookie(ck)
	}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

func jsonOf(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("not JSON (%d): %s", rec.Code, rec.Body.String())
	}
	return m
}

// connect runs authorize → consent → token the way Claude's connector does, and returns the token answer.
func connect(t *testing.T, a *app, ck *http.Cookie, clientID string) map[string]any {
	t.Helper()
	verifier := "a-verifier-of-at-least-forty-three-characters-0123456789"
	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {claudeReturn},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"},
		"state": {"st-1"}, "scope": {"wallets:read invoices:draft payments:prepare"}, "resource": {oauthOrigin + "/mcp"}}

	// Signed out, the person is sent to sign in and brought back here.
	out := serve(a, "GET", "/oauth/authorize?"+q.Encode(), "", "", nil, nil)
	if out.Code != http.StatusFound || !strings.HasPrefix(out.Header().Get("Location"), "/auth/login?return_to=%2Foauth%2Fauthorize") {
		t.Fatalf("signed out: %d %s", out.Code, out.Header().Get("Location"))
	}

	page := serve(a, "GET", "/oauth/authorize?"+q.Encode(), "", "", nil, ck)
	body := page.Body.String()
	for _, want := range []string{"See your wallets and bills", "Draft invoices and payees", "Prepare payments for you to approve", "ada@example.com", "claude.ai"} {
		if !strings.Contains(body, want) {
			t.Fatalf("consent screen (%d) lacks %q: %s", page.Code, want, body)
		}
	}
	if csp := page.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "form-action 'self' https://claude.ai") {
		t.Fatalf("the consent form cannot redirect to the client under CSP %q", csp)
	}
	consent := strings.SplitN(strings.SplitN(body, `name="consent" value="`, 2)[1], `"`, 2)[0]

	// Only the app's own page may answer it.
	if rec := serve(a, "POST", "/oauth/authorize", "https://evil.example", "consent="+consent+"&decision=allow", nil, ck); rec.Code != http.StatusForbidden {
		t.Fatalf("a consent posted from another site got %d", rec.Code)
	}
	allow := serve(a, "POST", "/oauth/authorize", oauthOrigin, "consent="+consent+"&decision=allow", nil, ck)
	back, _ := url.Parse(allow.Header().Get("Location"))
	if allow.Code != http.StatusFound || !strings.HasPrefix(back.String(), claudeReturn+"?") ||
		back.Query().Get("state") != "st-1" || back.Query().Get("iss") != oauthOrigin || back.Query().Get("code") == "" {
		t.Fatalf("allow: %d %s", allow.Code, back)
	}
	code := back.Query().Get("code")

	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {claudeReturn},
		"client_id": {clientID}, "resource": {oauthOrigin + "/mcp"}}
	form.Set("code_verifier", "the-wrong-verifier-of-at-least-forty-three-characters")
	if rec := serve(a, "POST", "/oauth/token", "", form.Encode(), nil, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("a wrong PKCE verifier got %d", rec.Code)
	}
	// The wrong verifier spent the code: a code is single-use whatever happened to it. Start again.
	page = serve(a, "GET", "/oauth/authorize?"+q.Encode(), "", "", nil, ck)
	consent = strings.SplitN(strings.SplitN(page.Body.String(), `name="consent" value="`, 2)[1], `"`, 2)[0]
	allow = serve(a, "POST", "/oauth/authorize", oauthOrigin, "consent="+consent+"&decision=allow", nil, ck)
	back, _ = url.Parse(allow.Header().Get("Location"))
	form.Set("code", back.Query().Get("code"))
	form.Set("code_verifier", verifier)
	tok := serve(a, "POST", "/oauth/token", "", form.Encode(), nil, nil)
	if tok.Code != http.StatusOK || tok.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("token: %d %s", tok.Code, tok.Body.String())
	}
	if rec := serve(a, "POST", "/oauth/token", "", form.Encode(), nil, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("a code used twice got %d", rec.Code)
	}
	return jsonOf(t, tok)
}

// seedOAuthToken connects an assistant for the fixture's person directly and returns its access token.
func seedOAuthToken(a *app) string {
	a.oauth.grants.put("g-seed", oauthGrant{ID: "g-seed", ClientID: "c-seed", ClientName: "Seed", Scope: "wallets:read",
		Who: oauthWho{sub: "sub-ada", email: "ada@example.com", workspaceID: "ws-ada"}, expires: time.Now().Add(time.Hour), endsAt: time.Now().Add(time.Hour)})
	a.oauth.access.put(tokenKey("tlv_oat_seed"), oauthToken{grantID: "g-seed", expires: time.Now().Add(time.Hour)})
	return "tlv_oat_seed"
}

func mcpWith(a *app, token string) *httptest.ResponseRecorder {
	return serve(a, "POST", "/mcp", "", `{"jsonrpc":"2.0","id":1,"method":"initialize"}`, map[string]string{"Authorization": "Bearer " + token}, nil)
}

// TestOAuthFlowAsClaudeRunsIt is B40.6's DONE: the whole flow the way Claude's connector runs it, for a
// client registered by CIMD and one registered by DCR, and a revoked token refused.
func TestOAuthFlowAsClaudeRunsIt(t *testing.T) {
	a, ck := oauthApp(t)

	// 1. The MCP address refuses an anonymous call and says where to learn how to sign in.
	anon := serve(a, "POST", "/mcp", "", `{}`, nil, nil)
	if anon.Code != http.StatusUnauthorized ||
		!strings.Contains(anon.Header().Get("WWW-Authenticate"), `resource_metadata="`+oauthOrigin+`/.well-known/oauth-protected-resource/mcp"`) {
		t.Fatalf("anonymous /mcp: %d %q", anon.Code, anon.Header().Get("WWW-Authenticate"))
	}

	// 2. Discovery: protected-resource metadata names this server; its metadata names every endpoint.
	prm := jsonOf(t, serve(a, "GET", "/.well-known/oauth-protected-resource/mcp", "", "", nil, nil))
	if prm["resource"] != oauthOrigin+"/mcp" || prm["authorization_servers"].([]any)[0] != oauthOrigin {
		t.Fatalf("protected-resource metadata: %v", prm)
	}
	asm := jsonOf(t, serve(a, "GET", "/.well-known/oauth-authorization-server", "", "", nil, nil))
	if asm["issuer"] != oauthOrigin || asm["registration_endpoint"] != oauthOrigin+"/oauth/register" ||
		asm["code_challenge_methods_supported"].([]any)[0] != "S256" || len(asm["code_challenge_methods_supported"].([]any)) != 1 ||
		asm["authorization_response_iss_parameter_supported"] != true || asm["client_id_metadata_document_supported"] != true {
		t.Fatalf("authorization-server metadata: %v", asm)
	}

	// 3a. A client by CIMD: its client_id is the https address of its own metadata document.
	var cimdID string
	doc := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"client_id": cimdID, "client_name": "Claude",
			"redirect_uris": []string{claudeReturn}, "token_endpoint_auth_method": "none"})
	}))
	defer doc.Close()
	cimdID = doc.URL + "/oauth/claude-client.json"
	a.connectorOut = doc.Client().Transport
	byCIMD := connect(t, a, ck, cimdID)

	// 3b. A client by DCR, the fallback.
	reg := serve(a, "POST", "/oauth/register", "", `{"client_name":"Claude","redirect_uris":["`+claudeReturn+`"],"token_endpoint_auth_method":"client_secret_post"}`, nil, nil)
	if reg.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", reg.Code, reg.Body.String())
	}
	client := jsonOf(t, reg)
	if client["token_endpoint_auth_method"] != "none" {
		t.Fatalf("registered as %v, want a public client", client["token_endpoint_auth_method"])
	}
	if rec := serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["javascript:alert(1)"]}`, nil, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("a javascript: redirect_uri was registered: %d", rec.Code)
	}
	dcrID := client["client_id"].(string)
	byDCR := connect(t, a, ck, dcrID)

	// 4. The access token reaches the MCP address, naming the person, the workspace and the client.
	for _, tok := range []map[string]any{byCIMD, byDCR} {
		rec := mcpWith(a, tok["access_token"].(string))
		if rec.Code == http.StatusUnauthorized || jsonOf(t, rec)["workspace_id"] != "ws-ada" || jsonOf(t, rec)["acting_as"] != "ada@example.com" {
			t.Fatalf("a fresh access token at /mcp: %d %s", rec.Code, rec.Body.String())
		}
	}

	// 5. Refresh rotates: the new pair works, and the old refresh token presented again ends the connection.
	refresh := func(rt string) *httptest.ResponseRecorder {
		return serve(a, "POST", "/oauth/token", "", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rt}, "client_id": {dcrID}}.Encode(), nil, nil)
	}
	old := byDCR["refresh_token"].(string)
	rot := refresh(old)
	if rot.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", rot.Code, rot.Body.String())
	}
	next := jsonOf(t, rot)
	if next["refresh_token"] == old || mcpWith(a, next["access_token"].(string)).Code == http.StatusUnauthorized {
		t.Fatalf("refresh did not rotate into a working pair: %v", next)
	}
	if rec := refresh(old); rec.Code != http.StatusBadRequest {
		t.Fatalf("a rotated refresh token was taken again: %d", rec.Code)
	}
	if rec := mcpWith(a, next["access_token"].(string)); rec.Code != http.StatusUnauthorized {
		t.Fatalf("after a replayed refresh token the connection still works: %d", rec.Code)
	}

	// 6. Revoked, a token is refused, and so is every token of its connection.
	at := byCIMD["access_token"].(string)
	if rec := serve(a, "POST", "/oauth/revoke", "", url.Values{"token": {byCIMD["refresh_token"].(string)}, "client_id": {cimdID}}.Encode(), nil, nil); rec.Code != http.StatusOK {
		t.Fatalf("revoke: %d", rec.Code)
	}
	rec := mcpWith(a, at)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Header().Get("WWW-Authenticate"), `error="invalid_token"`) {
		t.Fatalf("a revoked access token at /mcp: %d %q", rec.Code, rec.Header().Get("WWW-Authenticate"))
	}
}

// TestOAuthAuthorizeRefusesWithoutPKCE: no S256 challenge, no code — and the refusal is shown here, not redirected to
// an address anyone could have registered.
func TestOAuthAuthorizeRefusesWithoutPKCE(t *testing.T) {
	a, ck := oauthApp(t)
	client := jsonOf(t, serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["`+claudeReturn+`"]}`, nil, nil))
	q := url.Values{"response_type": {"code"}, "client_id": {client["client_id"].(string)}, "redirect_uri": {claudeReturn},
		"code_challenge": {"plain-challenge-plain-challenge-plain-challenge"}, "code_challenge_method": {"plain"}, "state": {"s"}}
	rec := serve(a, "GET", "/oauth/authorize?"+q.Encode(), "", "", nil, ck)
	if rec.Code != http.StatusBadRequest || rec.Header().Get("Location") != "" || !strings.Contains(rec.Body.String(), "invalid_request") {
		t.Fatalf("plain PKCE: %d %q", rec.Code, rec.Header().Get("Location"))
	}
}
