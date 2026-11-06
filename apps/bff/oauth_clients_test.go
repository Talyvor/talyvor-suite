package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// B52.2: the sign-ins Claude, Claude Code and ChatGPT actually run, against the client metadata documents they
// publish. testdata/connect holds those documents as fetched on 5 Nov 2026 from https://claude.ai/oauth/
// mcp-oauth-client-metadata, https://claude.ai/oauth/claude-code-client-metadata and https://chatgpt.com/oauth/client.json.

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// publishedClients answers each document's own address with the fixture, and ChatGPT's jwks_uri with jwks.
func publishedClients(t *testing.T, jwks []byte) http.RoundTripper {
	t.Helper()
	docs := map[string][]byte{"https://chatgpt.com/oauth/jwks.json": jwks}
	for _, name := range []string{"claude-client.json", "claude-code-client.json", "chatgpt-client.json"} {
		b, err := os.ReadFile("testdata/connect/" + name)
		if err != nil {
			t.Fatal(err)
		}
		var d struct {
			ClientID string `json:"client_id"`
		}
		if err := json.Unmarshal(b, &d); err != nil {
			t.Fatal(err)
		}
		docs[d.ClientID] = b
	}
	return roundTripFunc(func(r *http.Request) (*http.Response, error) {
		b, ok := docs[r.URL.String()]
		status := http.StatusOK
		if !ok {
			status = http.StatusNotFound
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(b)), Header: http.Header{}, Request: r}, nil
	})
}

// signInAs runs authorize → consent → token for clientID returning to redirectURI; extra adds to the token form
// (a client assertion). It returns the token response.
func signInAs(t *testing.T, a *app, ck *http.Cookie, clientID, redirectURI string, extra func() url.Values) *httptest.ResponseRecorder {
	t.Helper()
	verifier := "a-verifier-of-at-least-forty-three-characters-0123456789"
	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {redirectURI},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"},
		"state": {"st"}, "resource": {oauthOrigin + "/mcp"}}
	page := serve(a, "GET", "/oauth/authorize?"+q.Encode(), "", "", nil, ck)
	if page.Code != http.StatusOK {
		t.Fatalf("%s: consent screen %d: %s", clientID, page.Code, page.Body.String())
	}
	consent := strings.SplitN(strings.SplitN(page.Body.String(), `name="consent" value="`, 2)[1], `"`, 2)[0]
	allow := serve(a, "POST", "/oauth/authorize", oauthOrigin, "consent="+consent+"&decision=allow", nil, ck)
	back, _ := url.Parse(allow.Header().Get("Location"))
	if allow.Code != http.StatusFound || !strings.HasPrefix(back.String(), redirectURI+"?") {
		t.Fatalf("%s: allow went to %d %s", clientID, allow.Code, back)
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {back.Query().Get("code")}, "redirect_uri": {redirectURI},
		"client_id": {clientID}, "code_verifier": {verifier}, "resource": {oauthOrigin + "/mcp"}}
	if extra != nil {
		for k, v := range extra() {
			form[k] = v
		}
	}
	return serve(a, "POST", "/oauth/token", "", form.Encode(), nil, nil)
}

func TestOAuthSignInAsClaudeClaudeCodeAndChatGPT(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwks, _ := json.Marshal(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: key.Public(), KeyID: "k1", Algorithm: "RS256", Use: "sig"}}})
	a, ck := oauthApp(t)
	a.connectorOut = publishedClients(t, jwks)

	works := func(name string, rec *httptest.ResponseRecorder) map[string]any {
		t.Helper()
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: token %d: %s", name, rec.Code, rec.Body.String())
		}
		tok := jsonOf(t, rec)
		if m := mcpWith(a, tok["access_token"].(string)); m.Code != http.StatusOK {
			t.Fatalf("%s: its access token at /mcp: %d %s", name, m.Code, m.Body.String())
		}
		return tok
	}

	// Claude on the web returns to its one https callback.
	works("Claude", signInAs(t, a, ck, "https://claude.ai/oauth/mcp-oauth-client-metadata", claudeReturn, nil))

	// Claude Code registers port-less loopback callbacks and listens on whatever port is free (RFC 8252 §7.3).
	const claudeCode = "https://claude.ai/oauth/claude-code-client-metadata"
	works("Claude Code on localhost", signInAs(t, a, ck, claudeCode, "http://localhost:53682/callback", nil))
	works("Claude Code on 127.0.0.1", signInAs(t, a, ck, claudeCode, "http://127.0.0.1:41999/callback", nil))
	for _, bad := range []string{"http://localhost:53682/elsewhere", "http://127.0.0.1.evil.example:53682/callback", "http://evil.example/callback", "https://localhost:53682/callback",
		"http://someone@localhost:53682/callback", "http://127.0.0.1:41999/callback#elsewhere"} {
		q := url.Values{"response_type": {"code"}, "client_id": {claudeCode}, "redirect_uri": {bad}, "code_challenge_method": {"S256"},
			"code_challenge": {strings.Repeat("a", 43)}}
		if rec := serve(a, "GET", "/oauth/authorize?"+q.Encode(), "", "", nil, ck); rec.Code != http.StatusBadRequest || rec.Header().Get("Location") != "" {
			t.Fatalf("Claude Code returning to %s: %d %q", bad, rec.Code, rec.Header().Get("Location"))
		}
	}
	if rec := serve(a, "POST", "/oauth/register", "", `{"redirect_uris":["http://assistant.example/callback"]}`, nil, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("a non-loopback http redirect_uri was registered: %d", rec.Code)
	}

	// ChatGPT prefers private_key_jwt: it signs a client assertion with the key behind its jwks_uri (RFC 7523).
	const chatgpt = "https://chatgpt.com/oauth/client.json"
	assertion := func(signer *rsa.PrivateKey, jti string) func() url.Values {
		return func() url.Values {
			s, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: signer}, (&jose.SignerOptions{}).WithHeader("kid", "k1").WithType("JWT"))
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now()
			raw, err := jwt.Signed(s).Claims(jwt.Claims{Issuer: chatgpt, Subject: chatgpt, Audience: jwt.Audience{oauthOrigin + "/oauth/token"},
				ID: jti, IssuedAt: jwt.NewNumericDate(now), Expiry: jwt.NewNumericDate(now.Add(time.Minute))}).Serialize()
			if err != nil {
				t.Fatal(err)
			}
			return url.Values{"client_assertion_type": {"urn:ietf:params:oauth:client-assertion-type:jwt-bearer"}, "client_assertion": {raw}}
		}
	}
	asm := jsonOf(t, serve(a, "GET", "/.well-known/oauth-authorization-server", "", "", nil, nil))
	if methods, _ := json.Marshal(asm["token_endpoint_auth_methods_supported"]); string(methods) != `["none","private_key_jwt"]` {
		t.Fatalf("the metadata offers token endpoint auth %s", methods)
	}
	tok := works("ChatGPT", signInAs(t, a, ck, chatgpt, "https://chatgpt.com/connector_platform_oauth_redirect", assertion(key, "jti-1")))

	refresh := func(rt string, auth func() url.Values) (int, string) {
		form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rt}, "client_id": {chatgpt}}
		for k, v := range auth() {
			form[k] = v
		}
		rec := serve(a, "POST", "/oauth/token", "", form.Encode(), nil, nil)
		return rec.Code, rec.Body.String()
	}
	stranger, _ := rsa.GenerateKey(rand.Reader, 2048)
	if code, body := refresh(tok["refresh_token"].(string), assertion(stranger, "jti-2")); code != http.StatusUnauthorized || !strings.Contains(body, "invalid_client") {
		t.Fatalf("an assertion signed by a key not in ChatGPT's jwks: %d %s", code, body)
	}
	if code, body := refresh(tok["refresh_token"].(string), assertion(key, "jti-1")); code != http.StatusUnauthorized || !strings.Contains(body, "invalid_client") {
		t.Fatalf("a replayed assertion: %d %s", code, body)
	}
	if code, body := refresh(tok["refresh_token"].(string), assertion(key, "jti-3")); code != http.StatusOK {
		t.Fatalf("ChatGPT's refresh with a fresh assertion: %d %s", code, body)
	}
}

// TestOAuthTokenIsBoundToTheResource: a wrong resource is refused at both ends, and an access token is good only
// at the resource it was issued for.
func TestOAuthTokenIsBoundToTheResource(t *testing.T) {
	a, ck := oauthApp(t)
	a.connectorOut = publishedClients(t, nil)
	const claude = "https://claude.ai/oauth/mcp-oauth-client-metadata"
	q := url.Values{"response_type": {"code"}, "client_id": {claude}, "redirect_uri": {claudeReturn}, "code_challenge_method": {"S256"},
		"code_challenge": {strings.Repeat("a", 43)}, "resource": {oauthOrigin + "/mcp/"}}
	if rec := serve(a, "GET", "/oauth/authorize?"+q.Encode(), "", "", nil, ck); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_target") {
		t.Fatalf("authorize for another resource: %d", rec.Code)
	}
	wrong := func() url.Values { return url.Values{"resource": {"https://elsewhere.example/mcp"}} }
	if rec := signInAs(t, a, ck, claude, claudeReturn, wrong); rec.Code != http.StatusBadRequest {
		t.Fatalf("a token for another resource: %d", rec.Code)
	}

	rec := signInAs(t, a, ck, claude, claudeReturn, nil)
	at := jsonOf(t, rec)["access_token"].(string)
	a.cfg.publicBaseURL = "https://app.talyvor.example" // the resource this server is now is not the one the token was issued for
	if m := mcpWith(a, at); m.Code != http.StatusUnauthorized || !strings.Contains(m.Header().Get("WWW-Authenticate"), `error="invalid_token"`) {
		t.Fatalf("a token used at a resource it was not issued for: %d", m.Code)
	}
}

// ageClient moves a stored client's clock back by d, as if it had been fetched d ago.
func ageClient(a *app, id string, d time.Duration) {
	a.oauth.clients.update(id, func(c oauthClient) oauthClient {
		c.expires, c.refetch = c.expires.Add(-d), c.refetch.Add(-d)
		return c
	})
}

// B54.24: a refresh after the document's cache has lapsed is judged by the stored client when the document can't be
// fetched, so a slow or unreachable claude.ai never signs an assistant out; a document that can be read still wins.
func TestOAuthRefreshOutlivesTheClientsDocument(t *testing.T) {
	a, ck := oauthApp(t)
	published := publishedClients(t, nil)
	a.connectorOut = published
	const claudeCode = "https://claude.ai/oauth/claude-code-client-metadata"
	rt := jsonOf(t, signInAs(t, a, ck, claudeCode, "http://127.0.0.1:41999/callback", nil))["refresh_token"].(string)
	refresh := func() *httptest.ResponseRecorder {
		form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rt}, "client_id": {claudeCode}}
		return serve(a, "POST", "/oauth/token", "", form.Encode(), nil, nil)
	}

	ageClient(a, claudeCode, 11*time.Minute)
	a.connectorOut = roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("claude.ai is down") })
	rec := refresh()
	if rec.Code != http.StatusOK {
		t.Fatalf("a refresh 11 minutes after sign-in with claude.ai down: %d %s", rec.Code, rec.Body.String())
	}
	rt = jsonOf(t, rec)["refresh_token"].(string)

	// A document that is gone (404) is the client's own answer, not an outage: refused.
	ageClient(a, claudeCode, 11*time.Minute)
	a.connectorOut = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
	})
	if rec := refresh(); rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "invalid_client") {
		t.Fatalf("a refresh after the document was withdrawn: %d %s", rec.Code, rec.Body.String())
	}

	// The document comes back allowing only private_key_jwt: the next refresh that reads it is refused.
	ageClient(a, claudeCode, 11*time.Minute)
	a.connectorOut = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		res, err := published.RoundTrip(r)
		if err != nil || r.URL.String() != claudeCode {
			return res, err
		}
		var doc map[string]any
		if err := json.NewDecoder(res.Body).Decode(&doc); err != nil {
			return nil, err
		}
		doc["token_endpoint_auth_method"], doc["jwks_uri"] = "private_key_jwt", "https://claude.ai/oauth/jwks.json"
		b, _ := json.Marshal(doc)
		res.Body = io.NopCloser(bytes.NewReader(b))
		return res, nil
	})
	if rec := refresh(); rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "invalid_client") {
		t.Fatalf("a refresh after the document became stricter: %d %s", rec.Code, rec.Body.String())
	}
}
