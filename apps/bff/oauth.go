package main

// Talyvor Connect, part 1 (B40.6): an OAuth 2.1 authorization server so an outside assistant —
// Claude, ChatGPT, Le Chat, Cursor — can act for a signed-in person at https://app.talyvor.com/mcp.
//
// The person signs in through the existing OIDC session; this file adds only what the MCP
// authorization spec asks of the server side: RFC 8414 metadata, RFC 9728 protected-resource
// metadata, clients by Client ID Metadata Document (CIMD, preferred) or by RFC 7591 dynamic
// registration (the fallback), PKCE S256 only, the RFC 9207 iss parameter, short-lived access
// tokens with rotating refresh tokens, and RFC 7009 revocation. Every client is public: PKCE is
// the proof of possession, so no client secret is issued or accepted.
//
// A grant names the person (sub, email), the workspace and the client; B40.7's tools (mcp.go) read
// it through oauthGrantFrom.
//
// shortcut: grants, codes and registered clients live in this process's memory, so a BFF restart
// signs every assistant out and it asks the person to connect again; move them to a store when the
// BFF has one.

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

const (
	oauthAccessTTL  = time.Hour
	oauthRefreshTTL = 30 * 24 * time.Hour
	oauthCodeTTL    = 2 * time.Minute
	oauthConsentTTL = 10 * time.Minute
	// oauthGrantMaxAge is a connection's absolute lifetime: refreshing cannot extend it past this.
	oauthGrantMaxAge = 90 * 24 * time.Hour
	// A registered client nobody has consented to is forgotten after oauthUnusedClientTTL, so junk
	// registrations cannot hold the cap for long; consent keeps it for oauthClientTTL.
	oauthUnusedClientTTL = time.Hour
	oauthClientTTL       = 90 * 24 * time.Hour
	oauthCIMDTTL         = 10 * time.Minute
	// oauthCIMDTimeout keeps a slow metadata host inside Claude's 10-second limit on our answer.
	oauthCIMDTimeout = 5 * time.Second
	oauthMaxClients  = 10000
	oauthMaxBody     = 64 << 10
)

// oauthScopes are the three things an assistant may ask for, in the words the consent screen shows.
var oauthScopes = []struct{ name, words string }{
	{"wallets:read", "See your wallets and bills"},
	{"invoices:draft", "Draft invoices and payees"},
	{"payments:prepare", "Prepare payments for you to approve"},
}

func oauthScopeNames() []string {
	out := make([]string, len(oauthScopes))
	for i, s := range oauthScopes {
		out[i] = s.name
	}
	return out
}

type oauthClient struct {
	id           string
	name         string
	redirectURIs []string
	expires      time.Time
}

func (c oauthClient) expiresAt() time.Time { return c.expires }

// oauthWho is the person and workspace a grant acts for, copied from their session at consent, with the session's
// Lens credential: the MCP tools (mcp.go) call Lens with it, re-minted by provisioning as a session's is (tenant.go).
type oauthWho struct {
	sub, email, workspaceID string
	lensToken               string
	lensTokenExp            time.Time
	synthetic               bool
}

type oauthConsent struct {
	client                            oauthClient
	redirectURI, state, challenge, sc string
	sub                               string // the session that saw the screen is the only one that may answer it
	expires                           time.Time
}

func (c oauthConsent) expiresAt() time.Time { return c.expires }

type oauthCode struct {
	clientID, clientName, redirectURI, challenge, scope string
	who                                                 oauthWho
	expires                                             time.Time
}

func (c oauthCode) expiresAt() time.Time { return c.expires }

// oauthGrant is one assistant connected for one person: every token it is given points at it, and
// revoking any of them deletes it.
type oauthGrant struct {
	ID         string
	ClientID   string
	ClientName string
	Scope      string
	Who        oauthWho
	Created    time.Time
	LastUsed   time.Time
	expires    time.Time
	endsAt     time.Time // Created + oauthGrantMaxAge, whatever refreshes happen
}

func (g oauthGrant) expiresAt() time.Time { return g.expires }

// oauthToken is an access or refresh token, kept by its SHA-256 only. A refresh token is marked used
// when it is rotated; presenting it again is replay, and revokes the grant.
type oauthToken struct {
	grantID string
	used    bool
	expires time.Time
}

func (t oauthToken) expiresAt() time.Time { return t.expires }

type oauthServer struct {
	clients  *ttlMap[oauthClient]
	consents *ttlMap[oauthConsent]
	codes    *ttlMap[oauthCode]
	grants   *ttlMap[oauthGrant]
	access   *ttlMap[oauthToken]
	refresh  *ttlMap[oauthToken]
	drafts   *ttlMap[assistantDraft] // B40.35: payees and mandates an assistant left for the person to confirm (mcp_drafts.go)
}

func newOAuthServer() *oauthServer {
	return &oauthServer{clients: newTTLMap[oauthClient](), consents: newTTLMap[oauthConsent](),
		codes: newTTLMap[oauthCode](), grants: newTTLMap[oauthGrant](),
		access: newTTLMap[oauthToken](), refresh: newTTLMap[oauthToken](), drafts: newTTLMap[assistantDraft]()}
}

func tokenKey(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

// oauthOn answers 404 where there is nobody to sign in: disabled mode has no sessions to grant from.
func (a *app) oauthOn(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.cfg.authMode != authModeOIDC || a.auth == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "sign-in for assistants needs BFF_AUTH_MODE=oidc"})
			return
		}
		next(w, r)
	}
}

// oauthMachinePath names the endpoints an assistant's server calls without a browser: they have no
// Origin to send, and each authenticates its caller itself (PKCE verifier, refresh token, bearer).
func oauthMachinePath(path string) bool {
	switch path {
	case "/oauth/register", "/oauth/token", "/oauth/revoke", "/mcp":
		return true
	}
	return false
}

func (a *app) mcpResource() string { return a.cfg.publicBaseURL + "/mcp" }

func (a *app) handleProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"resource":                 a.mcpResource(),
		"authorization_servers":    []string{a.cfg.publicBaseURL},
		"scopes_supported":         oauthScopeNames(),
		"bearer_methods_supported": []string{"header"},
		"resource_name":            "Talyvor",
	})
}

func (a *app) handleAuthServerMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	base := a.cfg.publicBaseURL
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                         base,
		"authorization_endpoint":                         base + "/oauth/authorize",
		"token_endpoint":                                 base + "/oauth/token",
		"registration_endpoint":                          base + "/oauth/register",
		"revocation_endpoint":                            base + "/oauth/revoke",
		"scopes_supported":                               oauthScopeNames(),
		"response_types_supported":                       []string{"code"},
		"grant_types_supported":                          []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":               []string{"S256"},
		"token_endpoint_auth_methods_supported":          []string{"none"},
		"revocation_endpoint_auth_methods_supported":     []string{"none"},
		"authorization_response_iss_parameter_supported": true,
		"client_id_metadata_document_supported":          true,
	})
}

// validRedirectURI accepts https anywhere, http only on loopback (Claude Code, Cursor's local
// callback), and an app's own scheme (cursor://…); never a scheme a browser would run or read.
func validRedirectURI(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Fragment != "" || u.User != nil || len(raw) > 2000 {
		return false
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return u.Host != ""
	case "http":
		return isLoopbackHost(u.Hostname())
	case "", "javascript", "data", "file", "vbscript", "blob", "about", "ftp", "ws", "wss":
		return false
	}
	return true
}

func oauthError(w http.ResponseWriter, status int, code, desc string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]string{"error": code, "error_description": desc})
}

// handleOAuthRegister is RFC 7591 dynamic registration, the fallback for clients without a CIMD.
// Every client is registered public (token_endpoint_auth_method none) whatever it asked for; the
// answer says so and the client uses what it is answered.
func (a *app) handleOAuthRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var req struct {
		RedirectURIs []string `json:"redirect_uris"`
		ClientName   string   `json:"client_name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, oauthMaxBody)).Decode(&req); err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "the body is not a JSON client registration")
		return
	}
	if len(req.RedirectURIs) == 0 || len(req.RedirectURIs) > 10 {
		oauthError(w, http.StatusBadRequest, "invalid_redirect_uri", "give between one and ten redirect_uris")
		return
	}
	for _, u := range req.RedirectURIs {
		if !validRedirectURI(u) {
			oauthError(w, http.StatusBadRequest, "invalid_redirect_uri", fmt.Sprintf("%q is not https, a loopback http address or an app's own scheme", u))
			return
		}
	}
	name := strings.TrimSpace(req.ClientName)
	if len(name) > 100 {
		name = name[:100]
	}
	if name == "" {
		name = "An assistant"
	}
	if a.oauth.clients.size() >= oauthMaxClients {
		oauthError(w, http.StatusServiceUnavailable, "temporarily_unavailable", "too many clients are registered right now; try again later")
		return
	}
	id, err := randomToken()
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "entropy unavailable")
		return
	}
	id = "tlv_oc_" + id
	now := time.Now()
	a.oauth.clients.put(id, oauthClient{id: id, name: name, redirectURIs: req.RedirectURIs, expires: now.Add(oauthUnusedClientTTL)})
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{
		"client_id":                  id,
		"client_id_issued_at":        now.Unix(),
		"client_name":                name,
		"redirect_uris":              req.RedirectURIs,
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
	})
}

// isCIMDClientID is the CIMD test: a client_id that is an https URL with a path is the address of
// the client's own metadata document.
func isCIMDClientID(id string) bool {
	u, err := url.Parse(id)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.Path != "" && u.Path != "/" &&
		u.Fragment == "" && u.User == nil && !strings.Contains(u.Path, "/./") && !strings.Contains(u.Path, "/../")
}

// oauthClientFor finds a registered client, or fetches and checks a CIMD client's document.
func (a *app) oauthClientFor(ctx context.Context, id string) (oauthClient, error) {
	if id == "" {
		return oauthClient{}, errors.New("client_id is missing")
	}
	if c, ok := a.oauth.clients.get(id); ok {
		return c, nil
	}
	if !isCIMDClientID(id) {
		return oauthClient{}, errors.New("this client_id is not registered here")
	}
	ctx, cancel := context.WithTimeout(ctx, oauthCIMDTimeout)
	defer cancel()
	// CIMD is exactly this: fetching the address the client names. connectorOut refuses private and
	// loopback addresses at dial time; https only, no redirects, 5 s and 64 KiB at most.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, id, nil)
	if err != nil {
		return oauthClient{}, err
	}
	req.Header.Set("Accept", "application/json")
	hc := &http.Client{Transport: a.connectorOut, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := hc.Do(req)
	if err != nil {
		return oauthClient{}, fmt.Errorf("the client's metadata document could not be read: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return oauthClient{}, fmt.Errorf("the client's metadata document answered %d", res.StatusCode)
	}
	var doc struct {
		ClientID     string   `json:"client_id"`
		ClientName   string   `json:"client_name"`
		RedirectURIs []string `json:"redirect_uris"`
		AuthMethod   string   `json:"token_endpoint_auth_method"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, oauthMaxBody)).Decode(&doc); err != nil {
		return oauthClient{}, errors.New("the client's metadata document is not JSON")
	}
	if doc.ClientID != id {
		return oauthClient{}, errors.New("the client's metadata document names a different client_id")
	}
	if doc.AuthMethod != "" && doc.AuthMethod != "none" {
		return oauthClient{}, fmt.Errorf("token_endpoint_auth_method %q is not supported; only public clients (none)", doc.AuthMethod)
	}
	if len(doc.RedirectURIs) == 0 || len(doc.RedirectURIs) > 10 || !allSatisfy(doc.RedirectURIs, validRedirectURI) {
		return oauthClient{}, errors.New("the client's metadata document has no usable redirect_uris")
	}
	name := strings.TrimSpace(doc.ClientName)
	if name == "" || len(name) > 100 {
		name = req.URL.Host
	}
	c := oauthClient{id: id, name: name, redirectURIs: doc.RedirectURIs, expires: time.Now().Add(oauthCIMDTTL)}
	if a.oauth.clients.size() < oauthMaxClients {
		a.oauth.clients.put(id, c)
	}
	return c, nil
}

func allSatisfy(xs []string, f func(string) bool) bool {
	for _, x := range xs {
		if !f(x) {
			return false
		}
	}
	return true
}

// redirectWith sends the browser back to the client with params and the RFC 9207 iss.
func (a *app) redirectWith(w http.ResponseWriter, r *http.Request, redirectURI string, params url.Values) {
	params.Set("iss", a.cfg.publicBaseURL)
	sep := "?"
	if strings.Contains(redirectURI, "?") {
		sep = "&"
	}
	http.Redirect(w, r, redirectURI+sep+params.Encode(), http.StatusFound)
}

func (a *app) handleOAuthAuthorize(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.oauthAuthorizeAsk(w, r)
	case http.MethodPost:
		a.oauthAuthorizeAnswer(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (a *app) oauthAuthorizeAsk(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	// Until the client and its redirect_uri check out, an error is shown here and never redirected.
	client, err := a.oauthClientFor(r.Context(), q.Get("client_id"))
	if err != nil {
		writeConnectPage(w, http.StatusBadRequest, connectPage{Problem: "This assistant could not be recognised: " + err.Error() + "."})
		return
	}
	redirectURI := q.Get("redirect_uri")
	if redirectURI == "" && len(client.redirectURIs) == 1 {
		redirectURI = client.redirectURIs[0]
	}
	if !slices.Contains(client.redirectURIs, redirectURI) {
		writeConnectPage(w, http.StatusBadRequest, connectPage{Problem: "This assistant asked to return to an address it did not register."})
		return
	}
	state := q.Get("state")
	// Shown here, never redirected: anyone can register a redirect_uri, and an error sent there before the
	// person has said yes would make this an open redirect (RFC 9700 §4.11.2).
	fail := func(code, desc string) {
		writeConnectPage(w, http.StatusBadRequest, connectPage{Problem: "This assistant's request was not valid (" + code + ": " + desc + "). Try connecting again from the assistant."})
	}
	if q.Get("response_type") != "code" {
		fail("unsupported_response_type", "only response_type=code")
		return
	}
	challenge := q.Get("code_challenge")
	if q.Get("code_challenge_method") != "S256" || len(challenge) < 43 || len(challenge) > 128 {
		fail("invalid_request", "PKCE with code_challenge_method=S256 is required")
		return
	}
	if res := q.Get("resource"); res != "" && res != a.mcpResource() {
		fail("invalid_target", "the only resource here is "+a.mcpResource())
		return
	}
	scope := oauthScopeNames()
	if raw := strings.Fields(q.Get("scope")); len(raw) > 0 {
		scope = nil
		for _, s := range raw {
			if !slices.Contains(oauthScopeNames(), s) {
				fail("invalid_scope", fmt.Sprintf("unknown scope %q", s))
				return
			}
			if !slices.Contains(scope, s) {
				scope = append(scope, s)
			}
		}
	}

	s, ok := a.auth.sessionFrom(r)
	if !ok {
		http.Redirect(w, r, "/auth/login?return_to="+url.QueryEscape(r.URL.RequestURI()), http.StatusFound)
		return
	}
	id, err := randomToken()
	if err != nil {
		writeConnectPage(w, http.StatusInternalServerError, connectPage{Problem: "Something went wrong on our side. Try again."})
		return
	}
	a.oauth.consents.put(id, oauthConsent{client: client, redirectURI: redirectURI, state: state, challenge: challenge,
		sc: strings.Join(scope, " "), sub: s.sub, expires: time.Now().Add(oauthConsentTTL)})

	page := connectPage{Client: client.name, Email: s.email, Consent: id, ReturnTo: redirectHost(redirectURI)}
	for _, sc := range oauthScopes {
		if slices.Contains(scope, sc.name) {
			page.Scopes = append(page.Scopes, sc.words)
		}
	}
	// The answer redirects to the client, and a form's redirect is held to form-action too.
	w.Header().Set("Content-Security-Policy", strings.Replace(contentSecurityPolicy,
		"form-action 'self'", "form-action 'self' "+cspSourceOf(redirectURI), 1))
	writeConnectPage(w, http.StatusOK, page)
}

// redirectHost is where the person goes back to, in the words the consent screen shows.
func redirectHost(raw string) string {
	u, _ := url.Parse(raw)
	if u.Host != "" {
		return u.Host
	}
	return u.Scheme + " (an app on this device)"
}

// cspSourceOf is the CSP source expression that admits a redirect to raw: its origin, or its scheme.
func cspSourceOf(raw string) string {
	u, _ := url.Parse(raw)
	if u.Scheme == "https" || u.Scheme == "http" {
		return u.Scheme + "://" + u.Host
	}
	return u.Scheme + ":"
}

func (a *app) oauthAuthorizeAnswer(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, oauthMaxBody)
	if err := r.ParseForm(); err != nil {
		writeConnectPage(w, http.StatusBadRequest, connectPage{Problem: "That answer could not be read. Start again from your assistant."})
		return
	}
	s, ok := a.auth.sessionFrom(r)
	c, found := a.oauth.consents.take(r.PostForm.Get("consent"))
	if !ok || !found || c.sub != s.sub {
		writeConnectPage(w, http.StatusBadRequest, connectPage{Problem: "This request has expired or was already answered. Start again from your assistant."})
		return
	}
	if r.PostForm.Get("decision") != "allow" {
		a.redirectWith(w, r, c.redirectURI, url.Values{"error": {"access_denied"}, "error_description": {"the person said no"}, "state": {c.state}})
		return
	}
	code, err := randomToken()
	if err != nil {
		writeConnectPage(w, http.StatusInternalServerError, connectPage{Problem: "Something went wrong on our side. Try again."})
		return
	}
	a.oauth.codes.put(tokenKey(code), oauthCode{clientID: c.client.id, clientName: c.client.name, redirectURI: c.redirectURI,
		challenge: c.challenge, scope: c.sc, who: oauthWho{sub: s.sub, email: s.email, workspaceID: s.workspaceID,
			lensToken: s.lensToken, lensTokenExp: s.lensTokenExp, synthetic: s.synthetic},
		expires: time.Now().Add(oauthCodeTTL)})
	if !isCIMDClientID(c.client.id) {
		a.oauth.clients.update(c.client.id, func(cl oauthClient) oauthClient { cl.expires = time.Now().Add(oauthClientTTL); return cl })
	}
	log.Printf("bff: oauth consent given by sub=%s to client %q", s.sub, c.client.name)
	a.redirectWith(w, r, c.redirectURI, url.Values{"code": {code}, "state": {c.state}})
}

// oauthClientID is the client a token request names, in the body or as Basic auth's user.
func oauthClientID(r *http.Request) string {
	if id := r.PostForm.Get("client_id"); id != "" {
		return id
	}
	if u, _, ok := r.BasicAuth(); ok {
		if id, err := url.QueryUnescape(u); err == nil {
			return id
		}
	}
	return ""
}

func (a *app) handleOAuthToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, oauthMaxBody)
	if err := r.ParseForm(); err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_request", "the body is not a form")
		return
	}
	f := r.PostForm
	clientID := oauthClientID(r)
	if res := f.Get("resource"); res != "" && res != a.mcpResource() {
		oauthError(w, http.StatusBadRequest, "invalid_target", "the only resource here is "+a.mcpResource())
		return
	}
	switch f.Get("grant_type") {
	case "authorization_code":
		c, ok := a.oauth.codes.take(tokenKey(f.Get("code")))
		if !ok || c.clientID != clientID || c.redirectURI != f.Get("redirect_uri") {
			oauthError(w, http.StatusBadRequest, "invalid_grant", "the code is unknown, used, expired, or was issued to another client or redirect_uri")
			return
		}
		sum := sha256.Sum256([]byte(f.Get("code_verifier")))
		if subtle.ConstantTimeCompare([]byte(base64.RawURLEncoding.EncodeToString(sum[:])), []byte(c.challenge)) != 1 {
			oauthError(w, http.StatusBadRequest, "invalid_grant", "code_verifier does not match the code_challenge")
			return
		}
		gid, err := randomToken()
		if err != nil {
			oauthError(w, http.StatusInternalServerError, "server_error", "entropy unavailable")
			return
		}
		now := time.Now()
		g := oauthGrant{ID: gid, ClientID: c.clientID, ClientName: c.clientName, Scope: c.scope, Who: c.who,
			Created: now, LastUsed: now, expires: now.Add(oauthRefreshTTL), endsAt: now.Add(oauthGrantMaxAge)}
		a.oauth.grants.put(gid, g)
		a.issueTokens(w, g)
	case "refresh_token":
		// Read and marked used under one lock, so two refreshes at once cannot both rotate it.
		var prev oauthToken
		t, ok := a.oauth.refresh.update(tokenKey(f.Get("refresh_token")), func(t oauthToken) oauthToken { prev = t; t.used = true; return t })
		g, live := a.oauth.grants.get(t.grantID)
		if !ok || !live || g.ClientID != clientID {
			oauthError(w, http.StatusBadRequest, "invalid_grant", "the refresh token is unknown, expired, revoked or another client's")
			return
		}
		if prev.used {
			// A rotated token came back: someone holds a copy. End the grant for everyone.
			a.oauth.grants.delete(g.ID)
			log.Printf("bff: oauth refresh token replayed for client %q (sub=%s) — the grant is revoked", g.ClientName, g.Who.sub)
			oauthError(w, http.StatusBadRequest, "invalid_grant", "this refresh token was already used; the connection is revoked")
			return
		}
		g, _ = a.oauth.grants.update(g.ID, func(g oauthGrant) oauthGrant {
			g.expires = time.Now().Add(oauthRefreshTTL)
			if g.expires.After(g.endsAt) {
				g.expires = g.endsAt
			}
			return g
		})
		a.issueTokens(w, g)
	default:
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token")
	}
}

func (a *app) issueTokens(w http.ResponseWriter, g oauthGrant) {
	at, err1 := randomToken()
	rt, err2 := randomToken()
	if err1 != nil || err2 != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "entropy unavailable")
		return
	}
	at, rt = "tlv_oat_"+at, "tlv_ort_"+rt
	now := time.Now()
	a.oauth.access.put(tokenKey(at), oauthToken{grantID: g.ID, expires: now.Add(oauthAccessTTL)})
	a.oauth.refresh.put(tokenKey(rt), oauthToken{grantID: g.ID, expires: now.Add(oauthRefreshTTL)})
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": at, "token_type": "Bearer", "expires_in": int(oauthAccessTTL.Seconds()),
		"refresh_token": rt, "scope": g.Scope,
	})
}

// handleOAuthRevoke is RFC 7009: either token ends the whole grant. An unknown token is answered 200
// too, so the endpoint tells a caller nothing about tokens it does not hold.
func (a *app) handleOAuthRevoke(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, oauthMaxBody)
	if err := r.ParseForm(); err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_request", "the body is not a form")
		return
	}
	key := tokenKey(r.PostForm.Get("token"))
	t, ok := a.oauth.access.get(key)
	if !ok {
		t, ok = a.oauth.refresh.get(key)
	}
	if ok {
		// Holding a public client's token is all the proof revoking it needs.
		if g, live := a.oauth.grants.get(t.grantID); live {
			a.oauth.grants.delete(g.ID)
			log.Printf("bff: oauth grant revoked by client %q (sub=%s)", g.ClientName, g.Who.sub)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
}

// oauthGrantFrom reads the request's bearer token. Refused, it has already answered 401 with the
// WWW-Authenticate header that sends an MCP client to the protected-resource metadata.
func (a *app) oauthGrantFrom(w http.ResponseWriter, r *http.Request) (oauthGrant, bool) {
	raw, hasBearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if hasBearer {
		if t, ok := a.oauth.access.get(tokenKey(strings.TrimSpace(raw))); ok {
			if g, live := a.oauth.grants.update(t.grantID, func(g oauthGrant) oauthGrant { g.LastUsed = time.Now(); return g }); live {
				return g, true
			}
		}
	}
	challenge := fmt.Sprintf(`Bearer resource_metadata="%s/.well-known/oauth-protected-resource/mcp", scope="%s"`,
		a.cfg.publicBaseURL, strings.Join(oauthScopeNames(), " "))
	if hasBearer {
		challenge += `, error="invalid_token", error_description="the access token is unknown, expired or revoked"`
	}
	w.Header().Set("WWW-Authenticate", challenge)
	writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sign in to Talyvor from your assistant to use this"})
	return oauthGrant{}, false
}

// ─── the consent screen ────────────────────────────────────────────────────────────────────────

type connectPage struct {
	Client, Email, Consent, ReturnTo, Problem string
	Scopes                                    []string
}

func writeConnectPage(w http.ResponseWriter, status int, p connectPage) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	data := struct {
		connectPage
		MarkDark, MarkLight template.HTML
	}{p, template.HTML(markFlatDark), template.HTML(markFlatLight)} // nosemgrep: go.lang.security.audit.xss.template-html-does-not-escape.unsafe-template-type -- both are SVG files embedded at build time, never caller text
	if err := connectPageTmpl.Execute(w, data); err != nil {
		log.Printf("bff: connect page render: %v", err)
	}
}

var connectPageTmpl = template.Must(template.New("connect").Parse(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#060A12">
<title>{{if .Problem}}Could not connect{{else}}Connect {{.Client}}{{end}} — Talyvor</title>
<style>
  :root { color-scheme: dark light;
          --tv-canvas: #060A12; --tv-surface: #081220; --tv-line: rgba(126,147,171,.18);
          --tv-ink: #E6EEF7; --tv-ink-muted: #7E93AB;
          --tv-accent: #3AD6C0; --tv-accent-hover: #55DFCC; --tv-on-accent: #060A12; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/24px "Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif;
         background: var(--tv-canvas); color: var(--tv-ink); }
  main { box-sizing: border-box; width: calc(100% - 2rem); max-width: 28rem; padding: 2rem 1.75rem;
         background: var(--tv-surface); border: 1px solid var(--tv-line); border-radius: 10px; }
  .mark-dark, .mark-light { width: 40px; height: 40px; margin: 0 0 1.5rem; }
  .mark-light { display: none; }
  .mark-dark svg, .mark-light svg { display: block; width: 40px; height: 40px; }
  h1 { font-size: 28px; line-height: 34px; font-weight: 500; letter-spacing: -0.01em; margin: 0; overflow-wrap: anywhere; }
  .rule { width: 32px; height: 2px; background: var(--tv-accent); margin: 1rem 0 1.25rem; }
  p { margin: 0 0 0.85rem; }
  ul { margin: 0 0 1rem; padding-left: 1.25rem; }
  li { margin: 0 0 0.35rem; }
  .muted { color: var(--tv-ink-muted); }
  strong { font-weight: 600; overflow-wrap: anywhere; }
  form { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1.25rem; }
  button { font: inherit; font-size: 14px; line-height: 20px; font-weight: 600; padding: 10px 18px;
           border-radius: 6px; cursor: pointer; border: 1px solid var(--tv-line); }
  button.allow { background: var(--tv-accent); color: var(--tv-on-accent); border-color: var(--tv-accent); }
  button.allow:hover { background: var(--tv-accent-hover); }
  button.deny { background: transparent; color: var(--tv-ink); }
  button:focus-visible { outline: 2px solid var(--tv-accent); outline-offset: 2px; }
  @media (prefers-color-scheme: light) {
    :root { --tv-canvas: #F4F7FB; --tv-surface: #FFFFFF; --tv-line: rgba(6,10,18,.10);
            --tv-ink: #060A12; --tv-ink-muted: #46586E;
            --tv-accent: #0F7A6C; --tv-accent-hover: #0A5F54; --tv-on-accent: #FFFFFF; }
    .mark-dark { display: none; }
    .mark-light { display: block; }
  }
</style>
<main>
  <div class="mark-dark">{{.MarkDark}}</div>
  <div class="mark-light">{{.MarkLight}}</div>
  {{if .Problem}}
  <h1>Could not connect</h1>
  <div class="rule"></div>
  <p>{{.Problem}}</p>
  {{else}}
  <h1>Connect {{.Client}} to Talyvor</h1>
  <div class="rule"></div>
  <p>{{.Client}} is asking to use your Talyvor workspace as <strong>{{.Email}}</strong>. It will be able to:</p>
  <ul>{{range .Scopes}}<li>{{.}}</li>{{end}}</ul>
  <p class="muted">It can never pay anything by itself: every payment waits for you to approve it in Talyvor.</p>
  <p class="muted">After you choose, you go back to <strong>{{.ReturnTo}}</strong>.</p>
  <form method="post" action="/oauth/authorize">
    <input type="hidden" name="consent" value="{{.Consent}}">
    <button class="allow" type="submit" name="decision" value="allow">Allow</button>
    <button class="deny" type="submit" name="decision" value="deny">Cancel</button>
  </form>
  {{end}}
</main>
</html>
`))
