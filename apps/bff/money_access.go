package main

import (
	"net/http"
	"net/url"
)

// money_access.go — B41.15: what may act for the workspace, for the Keys page (Lens B41.115), on this session's token:
//
//	GET  /api/money/access                               mandates, device keys and passkeys, each with its revoke route
//	POST /api/money/permission-mandates/{id}/revoke      that mandate stops at once
//
// Device keys revoke through money_devices.go; connected assistants list and revoke through oauth_connected.go.
// Lens decides who may list and revoke (the owner or an admin) and answers a refusal in its own words.

// handleMoneyAccess — GET /api/money/access.
func (a *app) handleMoneyAccess(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/access", nil)
}

// handleMoneyPermissionMandateRevoke — POST /api/money/permission-mandates/{id}/revoke.
func (a *app) handleMoneyPermissionMandateRevoke(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "mandate id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/permission-mandates/"+url.PathEscape(id)+"/revoke", nil)
}
