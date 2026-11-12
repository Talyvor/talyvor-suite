package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// money_card_disputes.go — B59.25: card disputes, merchant refunds and the card export, on this session's own token
// (Lens B59.24).
//
//	GET  /api/money/card-disputes                     the workspace's disputes, newest first, and where each stands
//	POST /api/money/card-disputes  {payment_id, reason}  dispute a card payment: the dispute, with the issuer once it took it
//	GET  /api/money/card-refunds                      the workspace's merchant refunds, newest first, and what each credited
//	GET  /api/money/card-exports?from=&to=            card payments, disputes and refunds from one day to another, both
//	                                                  included, as Lens's CSV
//
// Lens decides everything: whose payment may be disputed (the owner or an admin), where a dispute stands, and what a won
// dispute or a refund credits. The Sandbox's own outcome and refund triggers are not relayed: an issuer decides those.

// handleMoneyCardDisputes — GET lists the workspace's disputes; POST opens one on a card payment.
func (a *app) handleMoneyCardDisputes(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/card-disputes", nil)
	case http.MethodPost:
		var in struct {
			PaymentID string `json:"payment_id"`
			Reason    string `json:"reason"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensCardDisputeOpenBody: none
		body, _ := json.Marshal(map[string]string{"payment_id": in.PaymentID, "reason": in.Reason})
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/card-disputes", body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyCardRefunds — GET: the workspace's merchant refunds on its card payments.
func (a *app) handleMoneyCardRefunds(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/card-refunds", nil)
}

// handleMoneyCardExport — GET: the card export for a date range, a CSV download with Lens's filename. Lens answers CSV
// only, so the relay always reads it as a file.
func (a *app) handleMoneyCardExport(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	q := r.URL.Query()
	q.Set("format", "csv")
	r.URL.RawQuery = q.Encode()
	a.statementRelay(w, r, t, "/v1/money/card-exports", "from", "to", "format")
}
