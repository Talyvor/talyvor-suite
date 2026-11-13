package main

import (
	"encoding/json"
	"net/http"
)

// workspace_areas.go — B59.38: which areas the session's workspace has.
//
//	GET /api/workspace/areas → GET /v1/workspaces/{ws}/areas   {"areas":[...]}, as Lens answers it (B59.1)
//
// The phone shows an area's tab only when it is listed here. Every area is off until the operator switches it on
// for one workspace, so a default workspace answers {"areas":[]}.
//
// The workspace is the session's (lensWorkspacePath), never one the request names. A failed or unreadable read is
// an error status, never an empty list: the phone must not take "could not read" for "has no areas".
func (a *app) handleWorkspaceAreas(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/areas"))
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway),
			map[string]string{"error": "could not read this workspace's areas"})
		return
	}
	var got struct {
		Areas []string `json:"areas"`
	}
	if err := json.Unmarshal(raw, &got); err != nil || got.Areas == nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not read this workspace's areas"})
		return
	}
	writeJSON(w, http.StatusOK, map[string][]string{"areas": got.Areas})
}
