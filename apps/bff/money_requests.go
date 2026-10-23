package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// money_requests.go — B40.9: the approval screen at /approve/<id>, the page a prepared request's approval link opens
// (Lens B40.3), approved once with a passkey over exactly the items shown (Lens B40.5), on this session's own token.
//
//	GET  /api/money/payment-requests/{id}                               the request: each item, its decision and rule
//	POST /api/money/payment-requests/{id}/approval {positions}          the statement approving those items, its challenge
//	                                                                    and the passkeys that may sign it
//	POST /api/money/payment-requests/{id}/approve {statement, assertion} keep the signed approval; Lens pays each item once
//
// Lens decides everything: who may approve, what the statement says, whether the signature covers it and what posts.

// handleMoneyPaymentRequest — GET /api/money/payment-requests/{id}.
func (a *app) handleMoneyPaymentRequest(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "request id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/payment-requests/"+url.PathEscape(id), nil)
}

// handleMoneyPaymentRequestApproval — POST /api/money/payment-requests/{id}/approval {positions}: the statement to sign.
func (a *app) handleMoneyPaymentRequestApproval(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "request id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Positions []int `json:"positions"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&in); err != nil || len(in.Positions) == 0 {
		// Never empty: Lens reads no positions as "every item", and the screen approves only what is ticked.
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tick at least one payment to approve"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensPaymentRequestApprovalBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/payment-requests/"+url.PathEscape(id)+"/approval", body)
}

// handleMoneyPaymentRequestApprove — POST /api/money/payment-requests/{id}/approve {statement, assertion}.
func (a *app) handleMoneyPaymentRequestApprove(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "request id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Statement string            `json:"statement"`
		Assertion *passkeyAssertion `json:"assertion"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Statement == "" || in.Assertion == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a request is approved with its statement and a passkey's assertion"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensPaymentRequestApproveBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/payment-requests/"+url.PathEscape(id)+"/approve", body)
}
