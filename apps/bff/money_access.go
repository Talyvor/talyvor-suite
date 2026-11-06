package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// money_access.go — B41.15: what may act for the workspace, for the Keys page (Lens B41.115), on this session's token:
//
//	GET  /api/money/access                               mandates, device keys and passkeys, each with its revoke route
//	POST /api/money/permission-mandates/{id}/revoke      that mandate stops at once
//
// Device keys revoke through money_devices.go; connected assistants list and revoke through oauth_connected.go.
// Lens decides who may list and revoke (the owner or an admin) and answers a refusal in its own words.
// B55.42: Lens names a mandate by its clients, "mcp:<client id>"; the list goes out with the assistant's own name.

// handleMoneyAccess — GET /api/money/access.
func (a *app) handleMoneyAccess(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	raw, err := a.lensGet(r.Context(), t, "/v1/money/access")
	var refused *lensStatusError
	if errors.As(err, &refused) && refused.status >= 400 && refused.status < 500 {
		// The Keys page answers a refusal from its status alone (403: only the owner or an admin).
		writeJSON(w, refused.status, map[string]string{"error": "Lens refused this"})
		return
	}
	var body struct {
		Items []map[string]any `json:"items"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &body)
	}
	if err != nil {
		log.Printf("bff: money access: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
		return
	}
	for _, it := range body.Items {
		if name, _ := it["name"].(string); it["kind"] == "mandate" {
			it["name"] = a.assistantNames(name)
		}
	}
	writeJSON(w, http.StatusOK, body)
}

// assistantNames is "Claude" for a mandate Lens names "mcp:<client id>": the name the assistant connected under.
func (a *app) assistantNames(clients string) string {
	var names []string
	for _, c := range strings.Split(clients, ", ") {
		id, ok := strings.CutPrefix(c, "mcp:")
		if !ok {
			continue
		}
		if g := a.oauth.grants.matching(func(g oauthGrant) bool { return g.ClientID == id && g.ClientName != "" }); len(g) > 0 {
			names = append(names, g[0].ClientName)
		} else if cl, ok := a.oauth.clients.get(id); ok && cl.name != "" {
			names = append(names, cl.name)
		}
	}
	if len(names) == 0 {
		return "A permission you signed"
	}
	return strings.Join(names, ", ")
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
