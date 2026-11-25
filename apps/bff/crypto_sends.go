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
//	POST /api/agents/{id}/crypto-sends/challenge        B48.50: the same body, with the Idempotency-Key header: what the
//	                                                    owner's send is signed over, and the quote it names (Lens B48.49)
//	POST /api/agents/{id}/crypto-sends       the same body, with the Idempotency-Key header and the owner's passkey
//	                                                    assertion: sends it once
//	GET  /api/agents/{id}/crypto-sends                  what the agent sent and was sent, each with its receipt
//	POST /api/agents/{id}/crypto-sends/{sid}/approve/challenge {test_amount_minor?}   B48.50: what that yes is signed over
//	POST /api/agents/{id}/crypto-sends/{sid}/approve {test_amount_minor?, assertion?}   the owner says yes, or sends a
//	                                                    test amount first
//	POST /api/agents/{id}/crypto-sends/{sid}/decline    the owner says no
//
// Lens decides everything — who may send, screening, the owner's spend permission, whether the owner is asked — on the
// session's own token. Every body sent up is rebuilt from the fields named here.
//
// B48.50 — `to` may also be a name.eth or the name of an address the owner saved, and the workspace's saved addresses
// are read and kept here (Lens B48.49), owner only:
//
//	GET    /api/crypto-addresses                         every saved address, by name
//	POST   /api/crypto-addresses {name, address}         saves it, or renames it when saved
//	DELETE /api/crypto-addresses/{id}                    removes it

// cryptoSendBody decodes the body a quote, a challenge and a send carry, or answers 400. Only a send carries the
// owner's passkey assertion up, as the browser made it; signed is false for the quote and the challenge.
func cryptoSendBody(w http.ResponseWriter, r *http.Request, signed bool) ([]byte, bool) {
	var in struct {
		To          string          `json:"to"`
		Network     string          `json:"network"`
		Token       string          `json:"token"`
		AmountMinor int64           `json:"amount_minor"`
		Assertion   json.RawMessage `json:"assertion,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return nil, false
	}
	if !signed || string(in.Assertion) == "null" {
		in.Assertion = nil
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
	body, ok := cryptoSendBody(w, r, false)
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// cryptoSendChallengeOrNotFound answers /api/agents/{id}/{kind}/{action}: …/crypto-sends/challenge, B48.44's
// …/wallet-moves/{mid}, and for any other path what the mux answered before this was mounted.
func (a *app) cryptoSendChallengeOrNotFound(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("kind") == "crypto-sends" && r.PathValue("action") == "challenge" {
		a.requireTenant(a.handleCryptoSendChallenge)(w, r)
		return
	}
	if r.PathValue("kind") == "wallet-moves" {
		a.requireTenant(a.handleWalletMove)(w, r)
		return
	}
	a.requireSession(a.handleAPINotFound)(w, r)
}

// handleCryptoSendChallenge — POST /api/agents/{id}/crypto-sends/challenge, under the send's own Idempotency-Key, which
// Lens binds into what is signed with the amount and the address `to` resolved to. Nothing moves.
func (a *app) handleCryptoSendChallenge(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "crypto-sends/challenge")
	if !ok {
		return
	}
	body, ok := cryptoSendBody(w, r, false)
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
		body, ok := cryptoSendBody(w, r, true)
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

// cryptoSendAnswerBody decodes a yes's {test_amount_minor?, assertion?}, or answers 400: nil when there is neither, which
// Lens reads as "send it all", unsigned. Only the yes itself carries the assertion up; signed is false for its challenge.
func cryptoSendAnswerBody(w http.ResponseWriter, r *http.Request, signed bool) ([]byte, bool) {
	var in struct {
		TestAmountMinor int64           `json:"test_amount_minor,omitempty"`
		Assertion       json.RawMessage `json:"assertion,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&in); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return nil, false
	}
	if !signed || string(in.Assertion) == "null" {
		in.Assertion = nil
	}
	if in.TestAmountMinor == 0 && in.Assertion == nil {
		return nil, true
	}
	// UPSTREAM-BINDS-ONLY lensCryptoSendApproveBody: none
	body, _ := json.Marshal(in)
	return body, true
}

// handleCryptoSendApprove — POST /api/agents/{id}/crypto-sends/{sid}/approve. With a test amount, Lens sends that much
// first; with none, the whole send. Once the workspace has a passkey, the yes carries its assertion over …/challenge.
func (a *app) handleCryptoSendApprove(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := cryptoSendSuffix(w, r, "approve")
	if !ok {
		return
	}
	body, ok := cryptoSendAnswerBody(w, r, true)
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleCryptoSendApproveChallenge — POST /api/agents/{id}/crypto-sends/{sid}/approve/challenge {test_amount_minor?}:
// what the owner's yes, or their test amount, is signed over. Nothing moves.
func (a *app) handleCryptoSendApproveChallenge(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := cryptoSendSuffix(w, r, "approve/challenge")
	if !ok {
		return
	}
	body, ok := cryptoSendAnswerBody(w, r, false)
	if !ok {
		return
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

// handleCryptoAddresses — GET /api/crypto-addresses lists the workspace's saved addresses; POST {name, address} saves
// one. Lens lets only the workspace's owner, signed in, read or keep them.
func (a *app) handleCryptoAddresses(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, "/crypto-addresses", nil)
	case http.MethodPost:
		var in struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<11)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensCryptoAddressBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelay(w, r, t, http.MethodPost, "/crypto-addresses", body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleCryptoAddress — DELETE /api/crypto-addresses/{id} removes a saved address.
func (a *app) handleCryptoAddress(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	id, ok := pathID(w, "address id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodDelete, "/crypto-addresses/"+url.PathEscape(id), nil)
}
