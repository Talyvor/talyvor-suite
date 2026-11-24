package main

// B52.38 — a person deletes their account from Settings. POST /auth/account/delete, with the session's email typed
// back, asks Lens's POST /v1/account/delete (talyvor-lens B52.37) to delete every account of the session's identity,
// on the provision secret. Only once Lens has, the BFF ends every sign-in of the person as sign out everywhere does
// (endEverywhere): every browser and phone session and every assistant connected through Connect, in the table first
// and then in memory, so a restart brings none of them back. The Help chats Talyvor kept for those accounts go too.
//
// Lens answers 404 to an identity with no account left, so a deletion whose ending failed is finished by asking again.

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
)

// accountDeletePath is Lens's account deletion (talyvor-lens cmd/lens/account_delete_handler.go).
const accountDeletePath = "/v1/account/delete"

// accountDeleteWord is what a person signed in without an email types back.
const accountDeleteWord = "DELETE"

// accountDeleteConfirm is what s's person must type back to delete their account: their email, or accountDeleteWord.
func accountDeleteConfirm(s session) string {
	if s.email != "" {
		return s.email
	}
	return accountDeleteWord
}

func (a *app) handleAccountDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if a.auth == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sign-in is off on this server, so there is no account to delete"})
		return
	}
	s, ok := a.auth.sessionFrom(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required — sign in at /signin"})
		return
	}
	if s.synthetic {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "a test account is not deleted here"})
		return
	}
	if a.oauth.db == nil || a.cfg.provisionSecret == "" {
		// Without the table a restart would bring the connections back, so the account is not deleted at all.
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "your account can't be deleted on this server yet"})
		return
	}
	var in struct {
		Confirm string `json:"confirm"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil ||
		!strings.EqualFold(strings.TrimSpace(in.Confirm), accountDeleteConfirm(s)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Type " + accountDeleteConfirm(s) + " exactly to delete your account."})
		return
	}

	// UPSTREAM-BINDS-ONLY lensAccountDeleteBody: none
	body, _ := json.Marshal(map[string]string{"identity": a.identityOf(s.sub)})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.lensBaseURL+accountDeletePath, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "your account couldn't be deleted. Nothing was deleted; try again later."})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(provisionSecretHeader, a.cfg.provisionSecret) // server-side only, never emitted
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: account deletion: lens unreachable: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "your account couldn't be deleted. Nothing was deleted; try again later."})
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var said struct {
		Error        string   `json:"error"`
		WorkspaceIDs []string `json:"workspace_ids"`
	}
	_ = json.Unmarshal(raw, &said)
	switch {
	case resp.StatusCode == http.StatusOK, resp.StatusCode == http.StatusNotFound:
	case (resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusServiceUnavailable) && said.Error != "":
		// Lens words these for the person: the money still held, or the step that has to wait.
		writeJSON(w, resp.StatusCode, map[string]string{"error": said.Error})
		return
	default:
		log.Printf("bff: account deletion: lens answered %d", resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "your account couldn't be deleted. Try again later."})
		return
	}

	for _, ws := range said.WorkspaceIDs {
		if err := a.help.closed(r.Context(), ws); err != nil {
			log.Printf("bff: account deletion: a deleted account's Help chat not deleted (workspace=%s): %v", ws, err)
		}
	}
	if err := a.endEverywhere(r.Context(), s); err != nil {
		log.Printf("bff: account deletion: deleted, but not signed out everywhere: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "your account is deleted, but you are still signed in somewhere. Try again to sign out everywhere."})
		return
	}
	clearCookie(w, sessionCookieName)
	log.Printf("bff: account deleted and signed out everywhere (sub=%s)", s.sub)
	w.WriteHeader(http.StatusNoContent)
}
