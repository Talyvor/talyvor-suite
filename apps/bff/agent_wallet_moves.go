package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"
)

// agent_wallet_moves.go — B48.47: the rest of an agent's crypto wallet on the web (Lens B48.8, B48.10, B48.14).
//
//	POST /api/agents/{id}/wallet-moves/quote {route, amount_minor, currency, from_agent_id?, payee_id?, to_currency?}
//	                                              a top-up (wallet, card, bank_transfer, convert) or a cash-out
//	                                              (cash_out) quoted: what it sells, the fee, the rate, what it buys
//	POST /api/agents/{id}/wallet-moves/{mid}/challenge   what a cash-out's or convert's confirm is signed over
//	POST /api/agents/{id}/wallet-moves/{mid}/confirm     {assertion?} make it, once
//	GET  /api/agents/{id}/wallet-moves                   its top-ups and cash-outs
//	GET  /api/agents/{id}/wallet/activity?limit=         its wallets' postings, newest first
//	GET  /api/agents/{id}/wallet/statement?month=&format=   a month's statement as JSON, CSV or PDF
//	GET  /api/agents/{id}/crypto-requests                its requests to be paid, each with where it stands
//	GET  /api/wallet/statement?month=&format=           B48.19: every wallet the owner has, the owner's own and each
//	                                              agent's, in one month's statement as JSON, CSV or PDF
//	POST /api/agents/{id}/crypto-requests  {token, network, amount_minor, memo, expires_at}   under the browser's
//	                                              Idempotency-Key: a request with its link and its QR code's URI
//
// Lens decides everything — the owner, the rate, the signature, what moves — on the session's own token. Every body
// sent up is rebuilt from the fields named here.

// handleWalletMoveQuote — POST /api/agents/{id}/wallet-moves/quote. Nothing moves.
func (a *app) handleWalletMoveQuote(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "wallet-moves/quote")
	if !ok {
		return
	}
	var in struct {
		Route       string `json:"route"`
		AmountMinor int64  `json:"amount_minor"`
		Currency    string `json:"currency"`
		FromAgentID string `json:"from_agent_id,omitempty"`
		PayeeID     string `json:"payee_id,omitempty"`
		ToCurrency  string `json:"to_currency,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensWalletMoveQuoteBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// walletMoveSuffix is the Lens suffix for one of the agent's moves, then action.
func walletMoveSuffix(w http.ResponseWriter, r *http.Request, action string) (string, bool) {
	mid, ok := pathID(w, "move id", r.PathValue("mid"))
	if !ok {
		return "", false
	}
	return agentSuffix(w, r, "wallet-moves/"+url.PathEscape(mid)+"/"+action)
}

// handleWalletMoveChallenge — POST /api/agents/{id}/wallet-moves/{mid}/challenge. No body goes up.
func (a *app) handleWalletMoveChallenge(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := walletMoveSuffix(w, r, "challenge")
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, nil)
}

// handleWalletMoveConfirm — POST /api/agents/{id}/wallet-moves/{mid}/confirm. The passkey's assertion goes up as the
// browser made it, or no body when there is none (a top-up, or a workspace that signs nothing yet).
func (a *app) handleWalletMoveConfirm(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := walletMoveSuffix(w, r, "confirm")
	if !ok {
		return
	}
	var in struct {
		Assertion json.RawMessage `json:"assertion,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&in); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	var body []byte
	// UPSTREAM-BINDS-ONLY lensWalletMoveConfirmBody: none
	if len(in.Assertion) > 0 && string(in.Assertion) != "null" {
		body, _ = json.Marshal(in)
	}
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleWalletMoves — GET /api/agents/{id}/wallet-moves.
func (a *app) handleWalletMoves(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix, ok := agentSuffix(w, r, "wallet-moves")
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
}

// handleAgentWalletActivity — GET /api/agents/{id}/wallet/activity?limit=; only limit goes up.
func (a *app) handleAgentWalletActivity(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix, ok := agentSuffix(w, r, "wallet/activity")
	if !ok {
		return
	}
	if l := r.URL.Query().Get("limit"); l != "" {
		suffix += "?" + url.Values{"limit": {l}}.Encode()
	}
	a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
}

// handleAgentWalletStatement — GET /api/agents/{id}/wallet/statement?month=&format=; a CSV or PDF comes down as the file.
func (a *app) handleAgentWalletStatement(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix, ok := agentSuffix(w, r, "wallet/statement")
	if !ok {
		return
	}
	a.statementRelay(w, r, t, lensWorkspacePath(t, suffix), "month", "format")
}

// handleOwnerWalletStatement — GET /api/wallet/statement?month=&format= (B48.19): every wallet's month in one file.
func (a *app) handleOwnerWalletStatement(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.statementRelay(w, r, t, lensWorkspacePath(t, "/wallet/statement"), "month", "format")
}

// handleAgentCryptoRequests — GET lists the agent's requests to be paid; POST asks for one, once per Idempotency-Key.
func (a *app) handleAgentCryptoRequests(w http.ResponseWriter, r *http.Request, t tenant) {
	suffix, ok := agentSuffix(w, r, "crypto-requests")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
	case http.MethodPost:
		var in struct {
			Token       string    `json:"token"`
			Network     string    `json:"network"`
			AmountMinor int64     `json:"amount_minor"`
			Memo        string    `json:"memo"`
			ExpiresAt   time.Time `json:"expires_at"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensCryptoRequestBody: payer_address
		body, _ := json.Marshal(in)
		a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}
