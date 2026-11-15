package main

import (
	"encoding/json"
	"net/http"
)

// workspace_plan.go — B57.18: the session's workspace's plan and how many agents it takes.
//
//	GET /api/plan → GET /v1/workspaces/{ws}/plan
//	    {"plan", "agents", "agents_used"}: the plan Lens has the workspace on, the agents that plan allows (-1 is
//	    unlimited) and the agents it has now (Lens plan_gates_handler.go)
//	    "seats": the members that plan takes (-1 is unlimited), Lens's gates.seats (B57.44)
//
// Home draws "3 of 3 on Free" from it, and Members says "Free has 1 seat" from it before anyone tries to add a person. The workspace is the session's (lensWorkspacePath), never one the request names.
// An answer with no plan or with counts that are not counts is a failed read, never passed on as a guess.
func (a *app) handleWorkspacePlan(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	failed := map[string]string{"error": "could not read this workspace's plan"}
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/plan"))
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), failed)
		return
	}
	var got struct {
		Plan  string `json:"plan"`
		Gates struct {
			Agents *int64 `json:"agents"`
			Seats  *int64 `json:"seats"`
		} `json:"gates"`
		AgentsUsed *int64 `json:"agents_used"`
	}
	if err := json.Unmarshal(raw, &got); err != nil || got.Plan == "" || got.Gates.Agents == nil || *got.Gates.Agents < -1 ||
		got.AgentsUsed == nil || *got.AgentsUsed < 0 || got.Gates.Seats == nil || *got.Gates.Seats < -1 {
		writeJSON(w, http.StatusBadGateway, failed)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Plan       string `json:"plan"`
		Agents     int64  `json:"agents"`
		AgentsUsed int64  `json:"agents_used"`
		Seats      int64  `json:"seats"`
	}{got.Plan, *got.Gates.Agents, *got.AgentsUsed, *got.Gates.Seats})
}
