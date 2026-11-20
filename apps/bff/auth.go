package main

// Sessions for the BFF. People join and sign in by phone number, a texted code, a passcode and a passkey
// (phone_signin.go, B61.25); Google sign-in is gone (B61.29). The Connect grants' own OAuth server (oauth.go) is how
// assistants connect, not how people sign in, and stays.
//
// The browser ends up holding exactly one thing: an opaque __Host- session cookie; the phone app, a Bearer token.
// The Lens workspace token lives and dies server-side.

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// __Host- prefix: the browser only accepts these over a secure origin, with
	// Secure + Path=/ and WITHOUT Domain — so the cookie is host-locked and a
	// sibling subdomain (anything.talyvor.com) cannot plant one that
	// app.talyvor.com would trust. setCookie encodes those attributes once.
	sessionCookieName = "__Host-talyvor_session"
)

// session is a server-side login: the browser holds only the opaque id.
type session struct {
	sub     string
	email   string
	expires time.Time

	// The tenant this person is, resolved ONCE at login by Lens's POST /v1/provision and cached
	// here SERVER-SIDE. The token never reaches the browser: the cookie carries only an opaque
	// session id, and these fields live in the BFF's own session map.
	workspaceID  string
	lensToken    string
	lensTokenExp time.Time

	// cachePoolable is the consent Lens RECORDED for this workspace (not what was requested).
	// needsPoolingChoice is true only for a workspace this login just created — the one moment
	// the pooling question is put to the person.
	cachePoolable      bool
	needsPoolingChoice bool

	// trackWorkspaceID is this person's Track workspace, resolved at login by Track's
	// idempotent POST /v1/bootstrap. EMPTY IS A VALID STATE, not an error: a Track failure
	// must not fail login, and the emptiness must not be trusted for the session's lifetime —
	// trackWorkspaceFor re-asks. See track_tenant.go for both rules.
	trackWorkspaceID string

	// synthetic marks a B17.2 test user's session (synthetic.go). Its workspace came from Lens's
	// synthetic routes, not from provisioning, so it is never re-provisioned (tenant.go).
	synthetic bool

	// signedInAt is when this person signed in (B55.54): getting a key back needs a sign-in within the last 10
	// minutes, so it goes to Lens with the recovery routes (key_recovery.go). It is when the passcode or the passkey
	// opened this session (phone_signin.go). Zero for a session no one signed in to, and then no recovery.
	signedInAt time.Time

	// B61.25 (phone_signin.go). personID is the person Lens knows;
	// joining is a sign-up session with no account yet, which may only finish sign-up. phone is the phone app's
	// session, whose lock is the server's: locked, and lastSeen and awayAt, which lock it after phoneLockAfter.
	personID string
	joining  bool
	phone    bool
	locked   bool
	lastSeen time.Time
	awayAt   time.Time
	// keyTicket is the ticket of the key sign-in that opened this session, the proof for its next key.
	keyTicket keyTicket
}

func (s session) expiresAt() time.Time { return s.expires }

type expirable interface{ expiresAt() time.Time }

// ttlMap is a mutex-guarded in-memory store with per-entry expiry. In-memory is
// a deliberate inc5 choice: one BFF process. A session outlives a restart only
// through its sealed id (session_seal.go). A multi-instance deployment swaps this
// for a shared store; nothing else changes.
type ttlMap[T expirable] struct {
	mu sync.Mutex
	m  map[string]T
}

func newTTLMap[T expirable]() *ttlMap[T] { return &ttlMap[T]{m: map[string]T{}} }

func (s *ttlMap[T]) put(id string, v T) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Opportunistic sweep: these maps are small (≤ active logins), so O(n) on
	// write is cheaper than a janitor goroutine.
	now := time.Now()
	for k, e := range s.m {
		if now.After(e.expiresAt()) {
			delete(s.m, k)
		}
	}
	s.m[id] = v
}

func (s *ttlMap[T]) get(id string) (T, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[id]
	if !ok || time.Now().After(v.expiresAt()) {
		delete(s.m, id)
		var zero T
		return zero, false
	}
	return v, true
}

// take is get-and-delete in one critical section: the caller gets the value at
// most once, which is what makes pending logins replay-proof.
func (s *ttlMap[T]) take(id string) (T, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[id]
	delete(s.m, id)
	if !ok || time.Now().After(v.expiresAt()) {
		var zero T
		return zero, false
	}
	return v, true
}

func (s *ttlMap[T]) size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.m)
}

func (s *ttlMap[T]) delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, id)
}

// adopt stores v under id only when id holds nothing live, and returns what id holds after: a
// session restored from its seal (session_seal.go) never overwrites one already restored or stored.
func (s *ttlMap[T]) adopt(id string, v T) T {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cur, ok := s.m[id]; ok && !time.Now().After(cur.expiresAt()) {
		return cur
	}
	s.m[id] = v
	return v
}

// update applies fn to the stored value INSIDE the lock and stores the result.
//
// The read-modify-write it replaces is the reason it exists: get → change one field → put is
// three separate critical sections, so a concurrent handler that changed a DIFFERENT field in
// between (the pooling choice clearing needsPoolingChoice, a Track bootstrap writing back its
// workspace) has its change silently overwritten by the stale copy. Rare, invisible, and
// exactly the kind of thing that surfaces as "I answered that question and it asked again".
//
// ⚠ BOTH SITES NAMED ABOVE WENT ON DOING get → change → put FOR THE LIFE OF THIS COMMENT, and the
// Track one held an HTTP round trip inside the window. There is a third consequence this comment
// did not state and `put` also has: it stores UNCONDITIONALLY, so a stale put RESURRECTS a session
// that logged out in between. `update` refuses an id that is gone, which is why it is the whole
// answer rather than half of one. Enforced now, not described: session_clobber_test.go parks each
// upstream mid-request to measure all three, and its census fails the build on the next
// `sessions.put` outside the login callback.
func (s *ttlMap[T]) update(id string, fn func(T) T) (T, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[id]
	if !ok || time.Now().After(v.expiresAt()) {
		var zero T
		return zero, false
	}
	v = fn(v)
	s.m[id] = v
	return v, true
}

// matching is every live value keep says yes to.
func (s *ttlMap[T]) matching(keep func(T) bool) []T {
	s.mu.Lock()
	defer s.mu.Unlock()
	now, out := time.Now(), []T{}
	for _, v := range s.m {
		if !now.After(v.expiresAt()) && keep(v) {
			out = append(out, v)
		}
	}
	return out
}

// authenticator owns the sign-in stores: sessions, and the phone checks waiting for their passcode. People join and
// sign in by phone number, passcode and passkey (phone_signin.go); Google sign-in is gone (B61.29).
type authenticator struct {
	cfg      config
	sessions *ttlMap[session]
	// phoneChecks are right codes waiting for their passcode (phone_signin.go, B61.25).
	phoneChecks *ttlMap[phoneCheck]
	// checkSealer makes a check id carry its check, so a restart keeps a confirmed number (B61.115).
	// Nil without LENS_PROVISION_SECRET: checks are then in memory only.
	checkSealer *checkSealer
	// sealer makes a session id carry its session, so a restart does not sign anyone out (B17.40).
	// Nil without LENS_PROVISION_SECRET: sessions are then in memory only.
	sealer *sessionSealer
}

// newAuthenticator builds the stores. It reaches nothing: OIDC_ISSUER is only the namespace the identities of people
// who first signed in with Google were made under (identityOf), and nothing is fetched from it.
func newAuthenticator(cfg config) *authenticator {
	return &authenticator{cfg: cfg, sessions: newTTLMap[session](),
		phoneChecks: newTTLMap[phoneCheck](),
		checkSealer: newCheckSealer(cfg.provisionSecret),
		sealer:      newSessionSealer(cfg.provisionSecret, cfg.sessionTTL)}
}

// session returns the session stored under sid, restoring it from its seal when this process has
// not seen it — the case after a restart (session_seal.go).
func (auth *authenticator) session(sid string) (session, bool) {
	if s, ok := auth.sessions.get(sid); ok {
		return s, true
	}
	if auth.sealer == nil {
		return session{}, false
	}
	s, ok := auth.sealer.open(sid)
	// A test user's session comes back only where test users may sign in at all.
	if !ok || (s.synthetic && auth.cfg.syntheticKey == "") {
		return session{}, false
	}
	log.Printf("bff: session restored from its seal for sub=%s", s.sub)
	return auth.sessions.adopt(sid, s), true
}

// endSession ends sid for good: gone from the map, and its seal can no longer restore it.
func (auth *authenticator) endSession(sid string) {
	auth.sessions.delete(sid)
	if auth.sealer != nil {
		auth.sealer.end(sid)
	}
}

// sessionAndIDFrom is sessionFrom plus the session id, for callers that must write the session
// back (the pooling choice).
// A Bearer token naming a session (the phone app, phone_signin.go) wins over the cookie; any other
// Bearer (an assistant's OAuth token, oauth.go) leaves the cookie to decide.
func (auth *authenticator) sessionAndIDFrom(r *http.Request) (string, session, bool) {
	if sid, s, ok := auth.bearerSession(r); ok {
		return sid, s, true
	}
	ck, err := r.Cookie(sessionCookieName)
	if err != nil || ck.Value == "" {
		return "", session{}, false
	}
	s, ok := auth.session(ck.Value)
	return ck.Value, s, ok
}

// bearerSession is the session a non-browser client names with `Authorization: Bearer <session id>`.
func (auth *authenticator) bearerSession(r *http.Request) (string, session, bool) {
	sid, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if sid == "" || sid == r.Header.Get("Authorization") {
		return "", session{}, false
	}
	s, ok := auth.session(sid)
	return sid, s, ok
}

func (auth *authenticator) sessionFrom(r *http.Request) (session, bool) {
	_, s, ok := auth.sessionAndIDFrom(r)
	return s, ok
}

// randomToken returns 256 bits of crypto/rand, URL-safe. Used for session ids,
// state, nonce and the pending-login id.
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// setCookie writes a __Host--compatible cookie: Secure, HttpOnly, SameSite=Lax,
// Path=/, no Domain. Lax (not Strict) because a link to the app opened from an
// email or another site is a top-level cross-site navigation, and Strict would
// arrive signed out; Lax still withholds cookies from cross-site subresources
// and POSTs, which is what CSRF needs.
func setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func clearCookie(w http.ResponseWriter, name string) { setCookie(w, name, "", -1) }

// handleAuthUnavailable answers for the login machinery when there is no live
// provider: an explicit 404 in disabled mode (so the SPA fallback never
// swallows /auth/*), and a fail-closed 503 if oidc mode is somehow wired
// without a provider. Returns true if it wrote a response.
func (a *app) handleAuthUnavailable(w http.ResponseWriter) bool {
	if a.cfg.authMode == authModeDisabled {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "authentication is disabled on this BFF (BFF_AUTH_MODE=disabled)",
		})
		return true
	}
	if a.auth == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authentication misconfigured"})
		return true
	}
	return false
}

// signInProducts readies the person's Track workspace and asks Docs to read its roster, at sign-in (landPerson,
// phone_signin.go), so a new person's first Docs write is not refused (FULL-STACK-DEPLOY.md STEP 3a-bis). Google's
// callback did this until B61.29 removed it. NEITHER IS A HARD STOP: Lens is the tenancy root, and a Track or Docs
// blip must not fail the sign-in. An empty Track workspace is kept as empty and re-asked on first use
// (track_tenant.go), and Docs' own sweep is the backstop (docs_membersync.go). Nothing about Docs is kept.
func (a *app) signInProducts(ctx context.Context, sub, email string) string {
	trackWS, terr := a.bootstrapTrackWorkspace(ctx, strings.ToLower(email), sub, a.cfg.oidcIssuer)
	if terr != nil && !errors.Is(terr, errTrackNotConfigured) {
		log.Printf("bff: track bootstrap FAILED for sub=%s (sign-in continues): %s", sub, redactSecret(terr.Error()))
	}
	if trackWS != "" {
		if derr := a.nudgeDocsMemberSync(ctx, trackWS); derr != nil && !errors.Is(derr, errDocsNotConfigured) {
			log.Printf("bff: docs member-sync nudge failed for sub=%s (sign-in continues; Docs' own "+
				"sweep will reconcile within its interval): %s", sub, redactSecret(derr.Error()))
		}
	}
	return trackWS
}

// startSession stores a new session and hands the browser its id. It is the one place a whole
// session is stored (session_clobber_test.go): the synthetic sign-in (synthetic.go) creates its
// session here. Any session this browser already held dies with it.
func (a *app) startSession(w http.ResponseWriter, r *http.Request, s session, maxAge int) error {
	if old, err := r.Cookie(sessionCookieName); err == nil {
		a.auth.endSession(old.Value)
	}
	sid, err := a.auth.storeSession(s)
	if err != nil {
		return err
	}
	setCookie(w, sessionCookieName, sid, maxAge)
	return nil
}

// storeSession stores a new session and returns its id. A cookie or a phone's bearer token carries it.
func (auth *authenticator) storeSession(s session) (string, error) {
	var sid string
	var err error
	if auth.sealer != nil {
		sid, err = auth.sealer.seal(s)
	} else {
		sid, err = randomToken()
	}
	if err != nil {
		return "", err
	}
	auth.sessions.put(sid, s)
	return sid, nil
}

// The logo's small drawing for this page and the OAuth consent page (oauth.go), both versions, copied byte for byte
// from brand/logo/svg (their ids differ, so both can sit in one page). Embedded, so neither page needs an asset request.
var (
	//go:embed brand/talyvor-logo-small-on-dark.svg
	logoDark string
	//go:embed brand/talyvor-logo-small-on-light.svg
	logoLight string
)

// signupIsOpen reports whether a person NOBODY HAS ADDED can complete signup on this
// deployment — i.e. whether the allowlist delegates wholly to the issuer.
//
// This one bit is rendered as
// PROSE on the marketing and signup pages ("anyone can start" vs "access is by
// invitation"), and a page whose sentence is computed from a second, parallel copy of
// the rule is a page that will eventually contradict the door it describes. One
// predicate, two readers.
func signupIsOpen(allowed []string) bool {
	return len(allowed) == 1 && allowed[0] == "*"
}

// handleLogout kills the session server-side and expires the cookie. POST only:
// SameSite=Lax withholds the session cookie from cross-site POSTs, so a foreign
// page cannot log the user out.
func (a *app) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if a.handleAuthUnavailable(w) {
		return
	}
	if sid, _, ok := a.auth.bearerSession(r); ok {
		a.auth.endSession(sid) // the phone signing out; it holds no cookie to clear
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if ck, err := r.Cookie(sessionCookieName); err == nil {
		a.auth.endSession(ck.Value)
	}
	clearCookie(w, sessionCookieName)
	w.WriteHeader(http.StatusNoContent)
}

// handleMe is the UI's one probe: always 200, reports the auth mode and — when
// authenticated — the identity. Never an error path, so the SPA can decide
// "show sign-in?" without special-casing statuses.
func (a *app) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if a.cfg.authMode == authModeDisabled || a.auth == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"mode": authModeDisabled, "authenticated": false, "user": nil,
			// Loopback dev has no gate at all, so nothing is turned away.
			"signup_open": true})
		return
	}
	if s, ok := a.auth.sessionFrom(r); ok {
		// workspace_id is this person's OWN derived id — safe to show, and useful when two
		// people compare screens. The token is never included: it stays server-side.
		writeJSON(w, http.StatusOK, map[string]any{
			"mode": authModeOIDC, "authenticated": true,
			"user":                 map[string]string{"sub": s.sub, "email": s.email},
			"workspace_id":         s.workspaceID,
			"cache_poolable":       s.cachePoolable,
			"needs_pooling_choice": s.needsPoolingChoice,
			// signup_open is documented at length below, on the UNAUTHENTICATED answer — the one
			// that matters. It is served here too so a signed-in operator reads the same bit.
			"signup_open": signupIsOpen(a.cfg.allowedEmails),
			// B20.12 — whether THIS person is on OPERATOR_SUBS, so the sidebar offers the review
			// queue only to someone it will admit. About the asker alone; requireOperator still decides.
			"operator": a.isOperator(s),
			// B61.25 — a sign-up still to choose its account.
			"signup_unfinished": s.joining,
		})
		return
	}
	// THE UNAUTHENTICATED ANSWER IS THE IMPORTANT ONE. Everyone who needs signup_open is by
	// definition not signed in: the marketing hero and the signup page have to tell a stranger,
	// before any login, whether they can actually get in.
	//
	// Hardcoding that sentence in the bundle is how a page comes to read "closed trial, accounts
	// set up by hand" for a month after the trial opened — or, far worse, "get started free"
	// while the gate is still six addresses, which sends every visitor into a refusal. A status
	// claim written in a static file reads as CURRENT to whoever is looking at it, and nothing
	// makes it false when the world moves.
	//
	// So the fact is served from the gate itself and the page renders the server's answer. It is
	// ONE BIT — whether the door is open — never who is behind it: no address, no count. A
	// stranger learns exactly what they would learn by trying the door, which is what they are
	// about to do anyway.
	writeJSON(w, http.StatusOK, map[string]any{
		"mode": authModeOIDC, "authenticated": false, "user": nil,
		"signup_open": signupIsOpen(a.cfg.allowedEmails)})
}

// requireSession gates every /api route. Disabled mode passes through — the
// loopback bind enforced at startup is the guard, as in inc2. Any other mode
// demands a valid session and answers 401 otherwise: an explicit refusal, never
// a silent empty result.
func (a *app) requireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.cfg.authMode == authModeDisabled {
			next(w, r)
			return
		}
		if a.auth == nil {
			// Fail closed: a half-wired auth surface never serves data.
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is not configured"})
			return
		}
		if _, ok := a.auth.sessionFrom(r); !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": "authentication required — sign in at /signin"})
			return
		}
		next(w, r)
	}
}
