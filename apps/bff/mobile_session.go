package main

// The phone app's sign-in (B40.11, talyvor-mobile). The phone runs the OIDC code + PKCE flow itself
// as a public client, then trades the ID token here for a session the BFF keeps exactly like a
// browser's. The phone sends that session id as `Authorization: Bearer <token>` on every later call;
// sessionAndIDFrom accepts it wherever the cookie is accepted, and a Bearer request needs no cookie
// and no Origin (lens.go's sameOriginWriteAllowed).

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
)

const mobileSessionPath = "/auth/mobile/session"

// spentIDToken marks a phone ID token already traded for a session, until the token itself expires.
type spentIDToken struct {
	by      string // the request that spent it
	expires time.Time
}

func (s spentIDToken) expiresAt() time.Time { return s.expires }

func (a *app) handleMobileSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if a.handleAuthUnavailable(w) {
		return
	}
	if a.auth.mobileVerifier == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "phone sign-in is not enabled on this BFF (OIDC_MOBILE_CLIENT_IDS is empty)"})
		return
	}
	var in struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil || in.IDToken == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `send {"id_token": "…"}`})
		return
	}
	ctx := r.Context()
	idt, err := a.auth.mobileVerifier.Verify(ctx, in.IDToken)
	if err != nil || !slices.ContainsFunc(idt.Audience, func(aud string) bool {
		return slices.Contains(a.cfg.oidcMobileClientIDs, aud)
	}) {
		log.Printf("bff: phone id_token rejected: %v", err)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "id_token failed verification"})
		return
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified *bool  `json:"email_verified"`
		AZP           string `json:"azp"`
	}
	if err := idt.Claims(&claims); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id_token claims unreadable"})
		return
	}
	// The party the token was issued to must be a phone client too, and must be named when there are several audiences.
	if (claims.AZP != "" || len(idt.Audience) > 1) && !slices.Contains(a.cfg.oidcMobileClientIDs, claims.AZP) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "id_token failed verification"})
		return
	}
	// One session per ID token: a copy replayed before it expires is refused. Keyed on the verified claims, not the
	// raw string, so a re-encoded copy of the same token is the same token.
	sum := sha256.Sum256([]byte(strings.Join([]string{idt.Issuer, idt.Subject, strconv.FormatInt(idt.IssuedAt.UnixNano(), 10),
		strings.Join(idt.Audience, " "), idt.Nonce, idt.AccessTokenHash}, "\x00")))
	mine, _ := randomToken()
	if a.auth.spentIDTokens.adopt(hex.EncodeToString(sum[:]), spentIDToken{by: mine, expires: idt.Expiry}).by != mine {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "this id_token was already used — sign in again"})
		return
	}
	if reason, allowed := authorizeIdentity(a.cfg.allowedEmails, idt.Subject, claims.Email, claims.EmailVerified); !allowed {
		log.Printf("bff: phone login DENIED — email=%s sub=%s reason=%s | to admit them, add that "+
			"address to OIDC_ALLOWED_EMAILS and RESTART the BFF (config is read at boot)",
			emailForLog(claims.Email), idt.Subject, reason)
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "this workspace has not granted you access"})
		return
	}
	s, err := a.provisionSession(ctx, idt.Subject, claims.Email)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "could not provision your workspace — try again shortly"})
		return
	}
	sid, err := a.auth.storeSession(s)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	log.Printf("bff: phone session created for sub=%s", idt.Subject)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{
		"token": sid, "expires_at": s.expires.UTC().Format(time.RFC3339)})
}
