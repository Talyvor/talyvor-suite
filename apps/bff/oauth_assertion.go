package main

// B52.2 — private_key_jwt (RFC 7523 §2.2) at /oauth/token, for a CIMD client whose metadata document allows it:
// ChatGPT's https://chatgpt.com/oauth/client.json prefers it. The client signs a short JWT naming itself and this
// server; the key is the one its document's jwks_uri publishes, fetched as the document is (public addresses
// only, https, no redirects, 5 s, 64 KiB).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

const (
	oauthAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
	// oauthAssertionMaxLife bounds how far ahead an assertion may expire, so the replay memory stays short.
	oauthAssertionMaxLife = 10 * time.Minute
)

// oauthAssertionAlgs are the signatures accepted: asymmetric only, so nothing a client holds is a shared secret.
var oauthAssertionAlgs = []string{string(jose.RS256), string(jose.PS256), string(jose.ES256)}

// oauthClientAuth authenticates a token request's client and returns its id. A public client proves nothing here:
// PKCE and the refresh token are its proof. A client assertion, when one is sent, must verify; a client whose
// document allows only private_key_jwt must send one.
func (a *app) oauthClientAuth(ctx context.Context, f url.Values, clientID string) (string, error) {
	raw := f.Get("client_assertion")
	if raw == "" && f.Get("client_assertion_type") == "" {
		if isCIMDClientID(clientID) {
			c, err := a.oauthTokenClient(ctx, clientID)
			if err != nil {
				return "", err
			}
			if !c.allows("none") {
				return "", errors.New("this client must authenticate with private_key_jwt")
			}
		}
		return clientID, nil
	}
	if f.Get("client_assertion_type") != oauthAssertionType {
		return "", errors.New("client_assertion_type must be " + oauthAssertionType)
	}
	algs := make([]jose.SignatureAlgorithm, len(oauthAssertionAlgs))
	for i, alg := range oauthAssertionAlgs {
		algs[i] = jose.SignatureAlgorithm(alg)
	}
	tok, err := jwt.ParseSigned(raw, algs)
	if err != nil {
		return "", fmt.Errorf("the client assertion is not a signed JWT: %w", err)
	}
	var unverified jwt.Claims
	if err := tok.UnsafeClaimsWithoutVerification(&unverified); err != nil {
		return "", errors.New("the client assertion's claims cannot be read")
	}
	if clientID == "" {
		clientID = unverified.Subject // RFC 7521 §4.2: client_id may be left to the assertion
	}
	if !isCIMDClientID(clientID) {
		return "", errors.New("only a client with a metadata document can authenticate with private_key_jwt")
	}
	c, err := a.oauthTokenClient(ctx, clientID)
	if err != nil {
		return "", err
	}
	if !c.allows("private_key_jwt") {
		return "", errors.New("this client's metadata document does not allow private_key_jwt")
	}
	keys, err := a.oauthJWKS(ctx, c.jwksURI)
	if err != nil {
		return "", err
	}
	var claims jwt.Claims
	verified := false
	for _, k := range keys.Keys {
		if kid := tok.Headers[0].KeyID; kid != "" && k.KeyID != kid {
			continue
		}
		if tok.Claims(k, &claims) == nil {
			verified = true
			break
		}
	}
	if !verified {
		return "", errors.New("the client assertion is not signed by a key the client publishes")
	}
	now := time.Now()
	base := a.cfg.publicBaseURL
	if err := claims.ValidateWithLeeway(jwt.Expected{Issuer: clientID, Subject: clientID,
		AnyAudience: jwt.Audience{base, base + "/oauth/token"}, Time: now}, 30*time.Second); err != nil {
		return "", fmt.Errorf("the client assertion is not for this request: %w", err)
	}
	if claims.Expiry == nil || claims.ID == "" || claims.Expiry.Time().After(now.Add(oauthAssertionMaxLife)) {
		return "", errors.New("the client assertion needs a jti and an exp at most ten minutes away")
	}
	// shortcut: the used-jti memory is this process's; a restart forgets it, which leaves an assertion that still
	// needs a live code with its PKCE verifier, or a live refresh token, to be worth anything.
	key := clientID + " " + claims.ID
	if _, seen := a.oauth.jtis.get(key); seen {
		return "", errors.New("this client assertion was already used")
	}
	a.oauth.jtis.put(key, oauthToken{expires: claims.Expiry.Time().Add(30 * time.Second)})
	return clientID, nil
}

// oauthTokenClient is the client a token request is judged by: its document when that can be read, else the row
// stored when it last was (unreachable, slow, 429, 5xx or not JSON; any other answer is the client's own refusal),
// so a slow or unreachable document host never signs an assistant out. A document that is read always wins, so one
// that has become stricter is refused at once.
func (a *app) oauthTokenClient(ctx context.Context, id string) (oauthClient, error) {
	c, err := a.oauthClientFor(ctx, id)
	if !errors.Is(err, errCIMDUnreadable) || ctx.Err() != nil {
		return c, err
	}
	// refetch stays where it is, so the next request reads the document again and /oauth/authorize never sees this row.
	stored, ok := a.oauth.clients.get(id)
	if !ok {
		return c, err
	}
	log.Printf("bff: oauth cimd client %q judged by its stored row: %v", id, err)
	return stored, nil
}

// oauthJWKS fetches the client's published keys the way its metadata document was fetched.
func (a *app) oauthJWKS(ctx context.Context, uri string) (jose.JSONWebKeySet, error) {
	var set jose.JSONWebKeySet
	ctx, cancel := context.WithTimeout(ctx, oauthCIMDTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return set, err
	}
	req.Header.Set("Accept", "application/json")
	hc := &http.Client{Transport: a.connectorOut, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := hc.Do(req)
	if err != nil {
		return set, fmt.Errorf("the client's keys could not be read: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return set, fmt.Errorf("the client's jwks_uri answered %d", res.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, oauthMaxBody)).Decode(&set); err != nil {
		return set, errors.New("the client's jwks_uri is not a JSON Web Key Set")
	}
	return set, nil
}
