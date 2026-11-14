package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
)

// workspace_account.go — B59.10: the session's workspace's type and kind of money.
//
//	GET /api/workspace/account → GET /v1/workspaces/{ws}/account
//	    {"workspace_id", "account_type", "money_kind", "country", "registration_number"}, as Lens answers it (B59.6, B59.40)
//
// The web renders Home, Pay, Cards, Wallets and Settings by these two words (SPEC 3.3 and 3.4), and the phone picks the
// owner card's face by them (B59.43). The country and registration number are the sign-up profile, "" when not given.
//
//	POST /api/workspace/account/money-kind/challenge {"money_kind"}  → POST …/account/money-kind/challenge (Lens B59.46)
//	PUT  /api/workspace/account/money-kind {"money_kind", "assertion"} → PUT …/account/money-kind
//
// B59.12: changing the kind is signed with the owner's passkey or phone key over the challenge for the kind picked.
// Lens decides the rest — a single kind becomes Hybrid at any time, Hybrid a single kind only once the other side holds
// nothing — and its 409 wrong_money_kind, naming the balances to empty, reaches the web as Lens said it.
//
// The workspace is the session's (lensWorkspacePath), never one the request names. A type or kind Lens does not name
// is a failed read, never passed on: the web must not draw a screen by a word it has no rule for.
func (a *app) handleWorkspaceAccount(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	failed := map[string]string{"error": "could not read this workspace's account"}
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/account"))
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), failed)
		return
	}
	var got struct {
		WorkspaceID        string `json:"workspace_id"`
		AccountType        string `json:"account_type"`
		MoneyKind          string `json:"money_kind"`
		Country            string `json:"country"`
		RegistrationNumber string `json:"registration_number"`
	}
	if err := json.Unmarshal(raw, &got); err != nil ||
		(got.AccountType != "business" && got.AccountType != "personal") ||
		(got.MoneyKind != "fiat" && got.MoneyKind != "stablecoin" && got.MoneyKind != "hybrid") {
		writeJSON(w, http.StatusBadGateway, failed)
		return
	}
	writeJSON(w, http.StatusOK, got)
}

// handleWorkspaceMoneyKind — PUT /api/workspace/account/money-kind, and POST …/money-kind/challenge when challenge.
// A kind Lens does not name, or a change with no signature, is refused here: there is no unsigned change to send.
func (a *app) handleWorkspaceMoneyKind(challenge bool) func(http.ResponseWriter, *http.Request, tenant) {
	method, suffix := http.MethodPut, "/account/money-kind"
	if challenge {
		method, suffix = http.MethodPost, "/account/money-kind/challenge"
	}
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != method {
			methodNotAllowed(w, method)
			return
		}
		var in struct {
			MoneyKind string            `json:"money_kind"`
			Assertion *passkeyAssertion `json:"assertion,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil ||
			(in.MoneyKind != "fiat" && in.MoneyKind != "stablecoin" && in.MoneyKind != "hybrid") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": `body must be {"money_kind": "fiat"|"stablecoin"|"hybrid"}`})
			return
		}
		switch {
		case challenge:
			in.Assertion = nil // the challenge names only the kind
		case in.Assertion == nil:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "changing the kind of money is signed with your passkey or phone key"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensWorkspaceMoneyKindBody: none
		body, _ := json.Marshal(in)
		if challenge {
			a.agentBankRelay(w, r, t, method, suffix, body)
			return
		}
		a.moneyKindChangeRelay(w, r, t, body)
	}
}

// moneyKindChangeRelay sends the signed change, and answers Lens's 409 wrong_money_kind with its balances to empty, in
// minor units by asset, which agentBankRelay's refusal (its sentence alone) would drop. Anything else is that relay's.
func (a *app) moneyKindChangeRelay(w http.ResponseWriter, r *http.Request, t tenant, body []byte) {
	path := lensWorkspacePath(t, "/account/money-kind")
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPut, a.cfg.lensBaseURL+path, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var refusal struct {
		Error     string           `json:"error"`
		Code      string           `json:"code"`
		MoneyKind string           `json:"money_kind"`
		Balances  map[string]int64 `json:"balances,omitempty"`
	}
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && json.Valid(raw):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter -- Lens's body sent as application/json, and every response carries nosniff (setSecurityHeaders)
		_, _ = w.Write(raw)
	case resp.StatusCode == http.StatusConflict && json.Unmarshal(raw, &refusal) == nil && refusal.Code == "wrong_money_kind":
		writeJSON(w, http.StatusConflict, refusal)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}
