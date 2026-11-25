package main

import (
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// agent_spend_permission.go — B48.48: an agent's Limits and permissions on the web (Lens B48.3).
//
//	GET  /api/agents/{id}/spend-permission           the permission in force, and whether the agent is frozen
//	POST /api/agents/{id}/spend-permission/prepare   {tokens: [{token, allowance, period, per_payment}], allowed,
//	                                                 blocked, expires}  its canonical JSON and the challenge the
//	                                                 passkey that owns the agent's account signs
//	PUT  /api/agents/{id}/spend-permission           {canonical, assertion}  kept once that passkey signed exactly it;
//	                                                 a permission with no tokens allows nothing, which is Freeze
//
// Lens decides everything — the owner, the number, whose passkey signs — on the session's own token. The prepare's
// body is rebuilt from the fields named here; the canonical JSON and the assertion go up as the browser has them.

// handleAgentSpendPermission — GET reads the agent's permission; PUT keeps a signed one.
func (a *app) handleAgentSpendPermission(w http.ResponseWriter, r *http.Request, t tenant) {
	suffix, ok := agentSuffix(w, r, "spend-permission")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
	case http.MethodPut:
		var in struct {
			Canonical string          `json:"canonical"`
			Assertion json.RawMessage `json:"assertion,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<15)).Decode(&in); err != nil || in.Canonical == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": `body must be {"canonical", "assertion"}`})
			return
		}
		// UPSTREAM-BINDS-ONLY lensSpendPermissionSetBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelay(w, r, t, http.MethodPut, suffix, body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
	}
}

// handleAgentSpendPermissionPrepare — POST /api/agents/{id}/spend-permission/prepare. Nothing is kept.
func (a *app) handleAgentSpendPermissionPrepare(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "spend-permission/prepare")
	if !ok {
		return
	}
	type tokenLimit struct {
		Token      string `json:"token"`
		Allowance  int64  `json:"allowance"`
		Period     string `json:"period"`
		PerPayment int64  `json:"per_payment"`
	}
	var in struct {
		Tokens  []tokenLimit `json:"tokens"`
		Allowed []string     `json:"allowed"`
		Blocked []string     `json:"blocked"`
		Expires time.Time    `json:"expires"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if in.Tokens == nil { // no tokens is Freeze: it goes up as an empty list, never as null
		in.Tokens = []tokenLimit{}
	}
	// UPSTREAM-BINDS-ONLY lensSpendPermissionPrepareBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}
