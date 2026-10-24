package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// workspace_name.go — B46.16: the workspace's name, which sign-up asks for on Home's first-agent card and the
// sidebar shows. Lens (B46.15) keeps it, trims it, holds it to 1–80 characters and lets only an owner or admin set it:
//
//	GET /api/workspace/name               {"id", "name"}
//	PUT /api/workspace/name   {"name"}    rename it; Lens's sentence comes back on a refusal
func (a *app) handleWorkspaceName(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, "/name", nil)
	case http.MethodPut:
		var in struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensWorkspaceNameBody: none
		body, _ := json.Marshal(map[string]string{"name": in.Name})
		a.agentBankRelay(w, r, t, http.MethodPut, "/name", body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
	}
}
