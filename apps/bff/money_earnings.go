package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// money_earnings.go — B55.28: where a workspace is paid its earnings, and a room's owner paying the room's members by
// its terms (Lens B46.11, cmd/lens/money_earnings_handler.go), on the session's own token:
//
//	GET  /api/money/payout-details    the workspace's payout details, each asset's, and whether each is verified
//	PUT  /api/money/payout-details    {asset, holder, iban, bic} or {asset: "USDC", holder, network: "base", address}
//	GET  /api/money/earnings-payouts  the payouts the workspace made or was paid, newest first
//	POST /api/rooms/{id}/payouts      {amount_minor, currency, shares}, under an Idempotency-Key: the room's wallet pays
//	                                  its members as the room's terms split it; one without verified details is held
//
// Lens decides who may (the workspace's owner or an admin; a room's payout, only its owner) and its sentence reaches
// the screen. Each body is rebuilt from the fields named here, and bank details are never logged: the relay logs only
// the method and the route.

// handleMoneyPayoutDetails — GET reads the workspace's payout details; PUT saves one asset's.
func (a *app) handleMoneyPayoutDetails(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/payout-details", nil)
	case http.MethodPut:
		var in struct {
			Asset   string `json:"asset"`
			Holder  string `json:"holder"`
			IBAN    string `json:"iban,omitempty"`
			BIC     string `json:"bic,omitempty"`
			Network string `json:"network,omitempty"`
			Address string `json:"address,omitempty"`
			Country string `json:"country,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPayoutDetailsBody: workspace_id, partner, status, updated_at
		body, _ := json.Marshal(in)
		a.agentBankRelayPath(w, r, t, http.MethodPut, "/v1/money/payout-details", body)
	default:
		methodNotAllowed(w, "GET, PUT")
	}
}

// handleMoneyEarningsPayouts — GET /api/money/earnings-payouts.
func (a *app) handleMoneyEarningsPayouts(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/earnings-payouts", nil)
}

// handleRoomPayouts — POST /api/rooms/{id}/payouts. The relay forwards the screen's Idempotency-Key, which Lens
// requires, so a retried click pays once.
func (a *app) handleRoomPayouts(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	path, ok := roomPath(w, r, "/payouts", false)
	if !ok {
		return
	}
	var in struct {
		AmountMinor int64          `json:"amount_minor"`
		Currency    string         `json:"currency"`
		Shares      map[string]int `json:"shares,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensRoomPayoutBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelayPath(w, r, t, http.MethodPost, path, body)
}
