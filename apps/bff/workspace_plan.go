package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// workspace_plan.go — B57.18: the session's workspace's plan and how many agents it takes.
//
//	GET /api/plan → GET /v1/workspaces/{ws}/plan
//	    {"plan", "agents", "agents_used"}: the plan Lens has the workspace on, the agents that plan allows (-1 is
//	    unlimited) and the agents it has now (Lens plan_gates_handler.go)
//	    "seats": the members that plan takes (-1 is unlimited), Lens's gates.seats (B57.44)
//	    "name", "account_type", "on_contract", "price_minor": the plan as people read it, the ladder it is chosen from
//	    (personal or business), whether a contract sets it, and its monthly price by currency, null on Custom (B61.59)
//
//	PUT /api/plan {"plan"} → PUT /v1/workspaces/{ws}/plan (B61.59): the owner moves the account to another plan of its
//	    own ladder. Lens decides; its refusal (a move down under too many agents, a paid plan while none can be
//	    charged, a plan of the other ladder) reaches Settings, Plan in its own words.
//
// Home draws "3 of 3 on Free" from it, and Members says "Free has 1 seat" from it before anyone tries to add a person. The workspace is the session's (lensWorkspacePath), never one the request names.
// An answer with no plan or with counts that are not counts is a failed read, never passed on as a guess.
func (a *app) handleWorkspacePlan(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method == http.MethodPut {
		a.handleWorkspacePlanChange(w, r, t)
		return
	}
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
		return
	}
	failed := map[string]string{"error": "could not read this workspace's plan"}
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/plan"))
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), failed)
		return
	}
	var got struct {
		Plan        string           `json:"plan"`
		Name        string           `json:"name"`
		AccountType string           `json:"account_type"`
		OnContract  bool             `json:"on_contract"`
		PriceMinor  map[string]int64 `json:"price_minor"`
		Gates       struct {
			Agents *int64 `json:"agents"`
			Seats  *int64 `json:"seats"`
		} `json:"gates"`
		AgentsUsed *int64 `json:"agents_used"`
	}
	if err := json.Unmarshal(raw, &got); err != nil || got.Plan == "" || got.Gates.Agents == nil || *got.Gates.Agents < -1 ||
		got.AgentsUsed == nil || *got.AgentsUsed < 0 || got.Gates.Seats == nil || *got.Gates.Seats < -1 ||
		got.Name == "" || (got.AccountType != "personal" && got.AccountType != "business") || !wholePrices(got.PriceMinor) {
		writeJSON(w, http.StatusBadGateway, failed)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Plan        string           `json:"plan"`
		Name        string           `json:"name"`
		AccountType string           `json:"account_type"`
		OnContract  bool             `json:"on_contract"`
		PriceMinor  map[string]int64 `json:"price_minor"`
		Agents      int64            `json:"agents"`
		AgentsUsed  int64            `json:"agents_used"`
		Seats       int64            `json:"seats"`
	}{got.Plan, got.Name, got.AccountType, got.OnContract, got.PriceMinor, *got.Gates.Agents, *got.AgentsUsed, *got.Gates.Seats})
}

// wholePrices reports whether a plan's monthly prices are each a currency with 0 or more minor units. nil is Custom,
// which a contract prices.
func wholePrices(prices map[string]int64) bool {
	for currency, n := range prices {
		if currency == "" || n < 0 {
			return false
		}
	}
	return true
}

// handleWorkspacePlanChange — PUT /api/plan {"plan"}: the plan change, on the session's own workspace. Only the plan's
// id is sent; whether it may be chosen is Lens's to say, and its refusal is passed on in its words.
func (a *app) handleWorkspacePlanChange(w http.ResponseWriter, r *http.Request, t tenant) {
	var in struct {
		Plan string `json:"plan"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Plan == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `body must be {"plan": a plan's id}`})
		return
	}
	// UPSTREAM-BINDS-ONLY lensWorkspacePlanChangeBody: members
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPut, "/plan", body)
}
