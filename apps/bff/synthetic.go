package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"time"
)

// B17.2 — SYNTHETIC USERS SIGN IN TO THE REAL WEB APP.
//
//	POST /auth/synthetic   X-Talyvor-Synthetic-Key: <LENS_SYNTHETIC_KEY>
//	                       {"workspace_id":"s…","token":"…","expires_at":"…"}
//
// The body is one entry of what Lens's POST /v1/synthetic/workspaces returned (B17.1). The BFF gives
// that workspace an ordinary browser session — the same __Host- cookie a Google sign-in gets — so a
// headless browser uses the real app exactly as a person does.
//
// ONLY A SYNTHETIC WORKSPACE, AND LENS IS THE ONE WHO SAYS SO. The BFF asks Lens for the workspace
// with the presented token (GET /v1/workspaces/{id}): Lens's isolation middleware refuses a token
// for any other workspace, and the answer must carry "synthetic": true, which only Lens's
// CreateSynthetic ever sets and nothing clears. A real workspace — even with its own valid token —
// is refused. The session is marked synthetic and is never re-provisioned (tenant.go), so it cannot
// turn into, or create, a real account either.
//
// POST /auth/synthetic/mobile (B57.86) takes the same header and body and makes the same checks, and
// answers as /auth/mobile/session does: {"token","expires_at"}, a Bearer session the phone app sends,
// and no cookie. It needs no Origin (lens.go's originExemptPath): the key is the proof.
//
// Unset LENS_SYNTHETIC_KEY (the default) and the route answers 404. The key is compared in constant
// time; every attempt on either door is logged once, with its outcome and its door, never with the
// key or the token (B54.32).

const (
	// syntheticKeyHeader is the header Lens's synthetic routes read (cmd/lens/synthetic_handler.go).
	syntheticKeyHeader = "X-Talyvor-Synthetic-Key"
	// syntheticEmailDomain is reserved (.invalid, RFC 2606): the address can never reach anyone.
	syntheticEmailDomain = "@synthetic.talyvor.invalid"
	// syntheticMobilePath is the phone's door (B57.86): the same check, a Bearer session instead of a cookie.
	syntheticMobilePath = "/auth/synthetic/mobile"
)

// syntheticWorkspaceIDShape bounds the id before it becomes a path segment. It is not the proof of
// being synthetic — Lens's answer is.
var syntheticWorkspaceIDShape = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func (a *app) handleSyntheticSignIn(w http.ResponseWriter, r *http.Request) {
	s, ok := a.syntheticSession(w, r)
	if !ok {
		return
	}
	if err := a.startSession(w, r, s, int(time.Until(s.expires).Seconds())); err != nil {
		logSyntheticAttempt(r, "store-failed", s.workspaceID, "")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	logSyntheticAttempt(r, "created", s.workspaceID, "")
	writeJSON(w, http.StatusOK, map[string]any{"workspace_id": s.workspaceID, "synthetic": true,
		"expires_at": s.expires.UTC().Format(time.RFC3339)})
}

// handleSyntheticMobileSignIn is B57.86: the same request and the same refusals as /auth/synthetic,
// answered as /auth/mobile/session answers the phone — a Bearer session in the body, no cookie.
func (a *app) handleSyntheticMobileSignIn(w http.ResponseWriter, r *http.Request) {
	s, ok := a.syntheticSession(w, r)
	if !ok {
		return
	}
	sid, err := a.auth.storeSession(s)
	if err != nil {
		logSyntheticAttempt(r, "store-failed", s.workspaceID, "")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	logSyntheticAttempt(r, "created", s.workspaceID, "")
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"token": sid, "expires_at": s.expires.UTC().Format(time.RFC3339)})
}

// syntheticSession checks a synthetic sign-in and builds its session; on a refusal it has answered w.
func (a *app) syntheticSession(w http.ResponseWriter, r *http.Request) (session, bool) {
	if a.cfg.syntheticKey == "" || a.auth == nil {
		logSyntheticAttempt(r, "not-enabled", "", "")
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "synthetic sign-in is not enabled on this BFF"})
		return session{}, false
	}
	if r.Method != http.MethodPost {
		logSyntheticAttempt(r, "wrong-method", "", "")
		methodNotAllowed(w, http.MethodPost)
		return session{}, false
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get(syntheticKeyHeader)), []byte(a.cfg.syntheticKey)) != 1 {
		logSyntheticAttempt(r, "bad-key", "", "")
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "the synthetic operator key is required"})
		return session{}, false
	}
	var in struct {
		WorkspaceID string `json:"workspace_id"`
		Token       string `json:"token"`
		ExpiresAt   string `json:"expires_at"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&in); err != nil ||
		!syntheticWorkspaceIDShape.MatchString(in.WorkspaceID) || in.Token == "" {
		logSyntheticAttempt(r, "bad-body", "", "")
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": `send {"workspace_id","token"} — one workspace from Lens's POST /v1/synthetic/workspaces`})
		return session{}, false
	}

	t := tenant{workspaceID: in.WorkspaceID, token: in.Token}
	ws, status := a.lensWorkspace(r, t)
	if status != http.StatusOK || ws.ID != in.WorkspaceID || !ws.Synthetic || !ws.Active {
		logSyntheticAttempt(r, "refused-by-lens", in.WorkspaceID,
			fmt.Sprintf(" lens=%d synthetic=%t active=%t", status, ws.Synthetic, ws.Active))
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "only a synthetic workspace can sign in this way, and Lens does not vouch for this one"})
		return session{}, false
	}

	expires := time.Now().Add(a.cfg.sessionTTL)
	tokenExp := parseExpiry(in.ExpiresAt)
	if !tokenExp.IsZero() && tokenExp.Before(expires) {
		expires = tokenExp
	}
	if !time.Now().Before(expires) {
		logSyntheticAttempt(r, "expired", ws.ID, "")
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "that synthetic token has expired — create new workspaces"})
		return session{}, false
	}
	return session{
		sub:          "synthetic:" + ws.ID,
		email:        ws.ID + syntheticEmailDomain,
		expires:      expires,
		workspaceID:  ws.ID,
		lensToken:    in.Token,
		lensTokenExp: tokenExp,
		// Lens turned pooling on when it created the workspace; there is no question to ask.
		cachePoolable: ws.CachePoolable,
		synthetic:     true,
	}, true
}

// logSyntheticAttempt writes the one line a synthetic sign-in attempt gets. workspaceID is "" until it
// has passed syntheticWorkspaceIDShape, so a caller's bytes never reach the log unchecked.
func logSyntheticAttempt(r *http.Request, outcome, workspaceID, detail string) {
	door := "browser"
	if r.URL.Path == syntheticMobilePath {
		door = "phone"
	}
	log.Printf("bff: synthetic sign-in %s door=%s from=%s workspace=%q%s", outcome, door, r.RemoteAddr, workspaceID, detail)
}

// lensWorkspaceRecord is the part of Lens's GET /v1/workspaces/{id} this file reads.
type lensWorkspaceRecord struct {
	ID            string `json:"id"`
	Active        bool   `json:"active"`
	CachePoolable bool   `json:"cache_poolable"`
	Synthetic     bool   `json:"synthetic"`
}

// lensWorkspace reads t's workspace from Lens with t's own token. Any failure is a zero record.
func (a *app) lensWorkspace(r *http.Request, t tenant) (lensWorkspaceRecord, int) {
	var ws lensWorkspaceRecord
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.cfg.lensBaseURL+lensWorkspacePath(t, ""), nil)
	if err != nil {
		return ws, http.StatusBadGateway
	}
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return ws, http.StatusBadGateway
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ws, resp.StatusCode
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&ws); err != nil {
		return lensWorkspaceRecord{}, http.StatusBadGateway
	}
	return ws, http.StatusOK
}
