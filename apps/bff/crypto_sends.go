package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// crypto_sends.go — B48.36: Send USDC from an agent's crypto wallet, on the web (Lens B48.9). Lens quotes it, sends it
// once per Idempotency-Key, keeps the receipt, and holds a first send to a new address for the owner:
//
//	GET  /api/agents/{id}/smart-account                 the agent's crypto wallet: its address, to send another agent money
//	POST /api/agents/{id}/crypto-sends/quote {to, network, token, amount_minor}   before sending: the amount, the most
//	                                                    the network fee can be and who pays it, the arrival, the
//	                                                    receiving agent's trust label, and whether it is a new address
//	POST /api/agents/{id}/crypto-sends       the same body, with the Idempotency-Key header: sends it once
//	GET  /api/agents/{id}/crypto-sends                  what the agent sent and was sent, each with its receipt
//	POST /api/agents/{id}/crypto-sends/{sid}/approve {test_amount_minor?}   the owner says yes, or sends a test amount first
//	POST /api/agents/{id}/crypto-sends/{sid}/decline    the owner says no
//
// Lens decides everything — who may send, screening, the owner's spend permission, whether the owner is asked — on the
// session's own token. Every body sent up is rebuilt from the fields named here.

// cryptoSendBody decodes the body a quote and a send carry, or answers 400.
func cryptoSendBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	var in struct {
		To          string `json:"to"`
		Network     string `json:"network"`
		Token       string `json:"token"`
		AmountMinor int64  `json:"amount_minor"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return nil, false
	}
	// UPSTREAM-BINDS-ONLY lensCryptoSendBody: none
	body, _ := json.Marshal(in)
	return body, true
}

// handleAgentSmartAccount — GET /api/agents/{id}/smart-account.
func (a *app) handleAgentSmartAccount(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix, ok := agentSuffix(w, r, "smart-account")
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
}

// handleCryptoSendQuote — POST /api/agents/{id}/crypto-sends/quote. Nothing moves.
func (a *app) handleCryptoSendQuote(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "crypto-sends/quote")
	if !ok {
		return
	}
	body, ok := cryptoSendBody(w, r)
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleCryptoSends — GET /api/agents/{id}/crypto-sends lists them; POST sends one, once per Idempotency-Key, which
// rides up in its header (Lens refuses a send without one).
func (a *app) handleCryptoSends(w http.ResponseWriter, r *http.Request, t tenant) {
	suffix, ok := agentSuffix(w, r, "crypto-sends")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
	case http.MethodPost:
		body, ok := cryptoSendBody(w, r)
		if !ok {
			return
		}
		a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// cryptoSendSuffix is the Lens suffix for one of the agent's sends, then action ("" for the send itself).
func cryptoSendSuffix(w http.ResponseWriter, r *http.Request, action string) (string, bool) {
	sid, ok := pathID(w, "send id", r.PathValue("sid"))
	if !ok {
		return "", false
	}
	suffix, ok := agentSuffix(w, r, "crypto-sends/"+url.PathEscape(sid))
	if !ok {
		return "", false
	}
	if action != "" {
		suffix += "/" + action
	}
	return suffix, true
}

// handleCryptoSendApprove — POST /api/agents/{id}/crypto-sends/{sid}/approve. With a test amount, Lens sends that much
// first; with none, the whole send. No body goes up when there is no test amount.
func (a *app) handleCryptoSendApprove(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := cryptoSendSuffix(w, r, "approve")
	if !ok {
		return
	}
	var in struct {
		TestAmountMinor int64 `json:"test_amount_minor"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&in); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	var body []byte
	// UPSTREAM-BINDS-ONLY lensCryptoSendApproveBody: none
	if in.TestAmountMinor != 0 {
		body, _ = json.Marshal(in)
	}
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleCryptoSendDecline — POST /api/agents/{id}/crypto-sends/{sid}/decline.
func (a *app) handleCryptoSendDecline(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := cryptoSendSuffix(w, r, "decline")
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, nil)
}
