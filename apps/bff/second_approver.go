package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// B28.40 — a Business account's second approver (talyvor-lens B28.315, cmd/lens/second_approver_handler.go):
//
//	GET  /api/workspace/second-approver            who, and the amount above which a payment needs them; empty when none
//	POST /api/workspace/second-approver/challenge  {user_id, above_minor, currency} → {challenge, allow_credentials}
//	PUT  /api/workspace/second-approver            {user_id, above_minor, currency, assertion?}; user_id "" and
//	                                               above_minor 0 clears it
//
// Relayed on the session's own token to the session's own workspace. Lens decides who may read and set it (the owner,
// on their own session, signed with a passkey once the workspace has one) and that a Personal account has none (404
// not_business). The body is rebuilt field by field: nothing else the browser sent reaches Lens.

const secondApproverPath = "/second-approver"

// handleSecondApprover — GET and PUT /api/workspace/second-approver, and POST …/challenge when challenge.
func (a *app) handleSecondApprover(challenge bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		switch {
		case !challenge && r.Method == http.MethodGet:
			a.agentBankRelay(w, r, t, http.MethodGet, secondApproverPath, nil)
			return
		case challenge && r.Method != http.MethodPost:
			methodNotAllowed(w, http.MethodPost)
			return
		case !challenge && r.Method != http.MethodPut:
			methodNotAllowed(w, "GET, PUT")
			return
		}
		var in struct {
			UserID     string            `json:"user_id"`
			AboveMinor int64             `json:"above_minor"`
			Currency   string            `json:"currency"`
			Assertion  *passkeyAssertion `json:"assertion,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.AboveMinor < 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": `body must be {"user_id", "above_minor", "currency": "GBP" | "EUR" | "USD" | "USDC"}`})
			return
		}
		if challenge {
			in.Assertion = nil // the challenge names only the line
		}
		// UPSTREAM-BINDS-ONLY lensSecondApproverBody: set_by, set_at (bound by Lens through the embedded line, never sent: Lens sets them)
		body, _ := json.Marshal(in)
		if challenge {
			a.agentBankRelay(w, r, t, http.MethodPost, secondApproverPath+"/challenge", body)
			return
		}
		a.agentBankRelay(w, r, t, http.MethodPut, secondApproverPath, body)
	}
}
