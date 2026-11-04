package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// money_search.go — B41.7: one search box across the workspace, on this session's own token.
//
//	GET /api/money/search?q=   the workspace's agents, payees, payments, bills, invoices, rules and listings matching q,
//	                           grouped by kind, each with the id that opens its own screen (Lens B41.107)
//
// Lens decides who may search (the owner or an admin) and what a query too short or too long is, in its own sentence.

func (a *app) handleMoneySearch(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	q := url.Values{"q": {r.URL.Query().Get("q")}}
	// Shown without the query: what a person searched for is theirs, not the log's.
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/search?"+q.Encode(), nil, "money search")
}

// B28.62 — limit-approach alerts, on this session's own token.
//
//	GET /api/money/budgets/alerts   every time spending reached 50, 80 or 100% of a budget, a card's cap or an agent's limit,
//	                                newest first, each once per period (Lens B28.335)
func (a *app) handleMoneyBudgetAlerts(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/budgets/alerts", nil, "limit alerts")
}

// B41.20 — the payments that recur, on this session's own token.
//
//	GET /api/money/spending/subscriptions   each card payment or payment out that recurs weekly or monthly, with its next date,
//	                                        the day to be reminded and its monthly and yearly cost (Lens B41.120)
func (a *app) handleMoneySubscriptions(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/spending/subscriptions", nil, "subscriptions")
}

// B41.39 — budgets by category, on this session's own token (Lens B41.139).
//
//	GET    /api/money/budgets        every budget, with this period's spending, what is left and the percent spent
//	PUT    /api/money/budgets        {agent_id, category, period, amount_minor, currency, timezone} — set one
//	DELETE /api/money/budgets/{id}   remove one
func (a *app) handleMoneyBudgets(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/budgets", nil, "budgets")
	case http.MethodPut:
		var in struct {
			AgentID     string `json:"agent_id"`
			Category    string `json:"category"`
			Period      string `json:"period"`
			AmountMinor int64  `json:"amount_minor"`
			Currency    string `json:"currency"`
			Timezone    string `json:"timezone"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensSpendBudgetBody: id, left_minor, percent, period_end, period_start, spent_minor
		body, _ := json.Marshal(in)
		a.lensRelay(w, r, t.token, http.MethodPut, "/v1/money/budgets", body, "budgets")
	default:
		methodNotAllowed(w, "GET, PUT")
	}
}

func (a *app) handleMoneyBudget(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	id, ok := pathID(w, "budget id", r.PathValue("id"))
	if !ok {
		return
	}
	a.lensRelay(w, r, t.token, http.MethodDelete, "/v1/money/budgets/"+url.PathEscape(id), nil, "budget")
}
