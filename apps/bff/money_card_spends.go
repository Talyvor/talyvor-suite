package main

import "net/http"

// money_card_spends.go — B59.54: an agent's one-time and standing cards, on this session's own token (Lens B59.21).
//
//	GET /api/money/card-spends?agent_id=   the agent's card spends, newest first, as Lens answers them: each with
//	                                       standing_card_id ("" for a one-time card), amount_minor and currency (the
//	                                       budget the owner approved), status, expires_at (when a standing card's raise
//	                                       ends) and card (the one-time card once issued)
//
// Reading only: an agent asks for a card spend itself, through Lens, never through the owner's app. Lens scopes the list
// to the session's own workspace, so another workspace's agent is an empty list.

// handleMoneyCardSpends — GET: an agent's card spends, Lens's body unchanged.
func (a *app) handleMoneyCardSpends(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.statementRelay(w, r, t, "/v1/money/card-spends", "agent_id")
}
