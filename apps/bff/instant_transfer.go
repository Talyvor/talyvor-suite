package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
)

// instant_transfer.go — B59.19: Instant transfer on the web, for a Hybrid account (launch pack 4.1 and 4.5). Lens B59.14
// quotes it, B59.15 to B59.17 send it to a Talyvor account, an outside wallet or an outside bank account, on this
// session's own token:
//
//	POST /api/money/instant-transfers/quote {send_minor, send_currency, receive_currency, to, country}   the quote,
//	                          locked for 30 seconds: you send, the fee, the rate, they get and when it arrives
//	POST /api/agents/{id}/instant-transfers {quote_id, to_account_id | to_payee_id}   send it from the agent's account at
//	                          the quote, once: the Idempotency-Key header goes up with it
//	GET  /api/money/instant-transfers/{id}           the receipt: where it stands, its legs and the on-chain reference
//
// Lens decides everything: the account's kind (a workspace that is not Hybrid is refused 409 wrong_money_kind), the
// agent's rule "Can use Instant transfer", screening, and whether the owner's signed approval is needed first. A refusal
// comes back with its sentence AND its code and field, because the screen picks its words from the field (DESIGN 6:
// "Lens answers with a field. The app picks the words from the field").

// handleInstantTransferQuote — POST /api/money/instant-transfers/quote.
func (a *app) handleInstantTransferQuote(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		SendMinor       int64  `json:"send_minor"`
		SendCurrency    string `json:"send_currency"`
		ReceiveCurrency string `json:"receive_currency"`
		To              string `json:"to"`
		Country         string `json:"country"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensInstantQuoteBody: none
	body, _ := json.Marshal(in)
	a.instantRelay(w, r, t, http.MethodPost, lensWorkspacePath(t, "/money/instant-transfers/quote"), body)
}

// handleInstantTransferSend — POST /api/agents/{id}/instant-transfers. Funding is never named: Lens sends test money
// until its capability is cleared for live money.
func (a *app) handleInstantTransferSend(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "money/instant-transfers")
	if !ok {
		return
	}
	var in struct {
		QuoteID     string `json:"quote_id"`
		ToAccountID string `json:"to_account_id,omitempty"`
		ToPayeeID   string `json:"to_payee_id,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// The key a retry sends again under rides in the Idempotency-Key header, which Lens reads over the body's.
	// UPSTREAM-BINDS-ONLY lensInstantSendBody: funding, idempotency_key
	body, _ := json.Marshal(in)
	a.instantRelay(w, r, t, http.MethodPost, lensWorkspacePath(t, suffix), body)
}

// handleInstantTransfer — GET /api/money/instant-transfers/{id}.
func (a *app) handleInstantTransfer(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "transfer id", r.PathValue("id"))
	if !ok {
		return
	}
	a.instantRelay(w, r, t, http.MethodGet, lensWorkspacePath(t, "/money/instant-transfers/"+url.PathEscape(id)), nil)
}

// instantRelay is lensRelay that keeps a 4xx's code and field beside its sentence: may_instant_transfer, screened,
// wrong_money_kind. Nothing else of a refusal's body is relayed.
func (a *app) instantRelay(w http.ResponseWriter, r *http.Request, t tenant, method, path string, body []byte) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, a.cfg.lensBaseURL+path, rd)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if k := r.Header.Get("Idempotency-Key"); k != "" && len(k) <= 128 {
		req.Header.Set("Idempotency-Key", k)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: instant transfer %s: %v", method, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && json.Valid(raw):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter -- Lens's body sent as application/json, and every response carries nosniff (setSecurityHeaders)
		_, _ = w.Write(raw)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		var refusal struct {
			Error string `json:"error"`
			Code  string `json:"code,omitempty"`
			Field string `json:"field,omitempty"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, refusal)
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}
