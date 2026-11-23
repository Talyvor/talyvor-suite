package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// money_cards.go — B28.49: an agent's single-use cards, on this session's own token (Lens B46.10).
//
//	GET  /api/money/cards?agent_id=          the agent's card batches with their cards, newest first, and where each stands
//	POST /api/money/cards {agent_id, purpose, currency, cards: [{merchant, cap_minor}]}, under the screen's Idempotency-Key:
//	                                         asks for up to 10 cards for one job, one per merchant, held for one approval
//	POST /api/money/cards/{id}/approve       the owner or an admin approves the batch: each card is issued and pays its
//	                                         merchant once, up to its cap, within 24 hours
//
// Lens decides everything: who may approve (the owner or an admin), what each card's cap holds, and that a card's second
// charge is declined. Funding is never relayed, so a batch is Lens's default; the Sandbox's charge trigger is not
// relayed either: a merchant makes a charge, not the owner.

// handleMoneyCards — GET lists the agent's batches; POST asks for one.
func (a *app) handleMoneyCards(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		path := "/v1/money/cards"
		if id := r.URL.Query().Get("agent_id"); id != "" {
			path += "?" + url.Values{"agent_id": {id}}.Encode()
		}
		a.agentBankRelayPath(w, r, t, http.MethodGet, path, nil)
	case http.MethodPost:
		var in struct {
			AgentID  string `json:"agent_id"`
			Purpose  string `json:"purpose"`
			Currency string `json:"currency"`
			Cards    []struct {
				Merchant string `json:"merchant"`
				CapMinor int64  `json:"cap_minor"`
			} `json:"cards"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		cards := make([]map[string]any, len(in.Cards))
		for i, c := range in.Cards {
			cards[i] = map[string]any{"merchant": c.Merchant, "cap_minor": c.CapMinor}
		}
		// UPSTREAM-BINDS-ONLY lensMoneyCardBatchBody: approved_at, approved_by, created_at, funding, id, idempotency_key, status, total_minor, workspace_id
		body, _ := json.Marshal(map[string]any{"agent_id": in.AgentID, "purpose": in.Purpose, "currency": in.Currency, "cards": cards})
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/cards", body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyCardApprove — POST /api/money/cards/{id}/approve: the batch approved by whoever this session signed in as.
func (a *app) handleMoneyCardApprove(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "card batch id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/cards/"+url.PathEscape(id)+"/approve", nil)
}
