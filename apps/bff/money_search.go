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

// B53.8 — the Spending screen and Chat's category totals, on this session's own token (Lens B53.3–B53.7).
//
//	GET /api/money/spending?from=&to=          the payments in [from, to), each with its category, and the totals by wallet,
//	                                           currency and category
//	GET /api/money/spending/unusual?from=&to=  what was unusual in [from, to), each finding with its numbers
//	PUT /api/money/spending/merchants          {merchant, category} — always put this merchant's payments in category
//	GET /api/money/coach                       the Coach's sentence for each finding and the week's review
//	GET /api/money/notices                     the notice settings and the latest notices
//	PUT /api/money/notices/settings            {timezone, quiet_from, quiet_until, off}
func (a *app) handleMoneySpending(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/spending"+spendPeriod(r), nil, "spending")
}

func (a *app) handleMoneySpendingUnusual(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/spending/unusual"+spendPeriod(r), nil, "unusual spending")
}

// spendPeriod is the from and to of r's query, and nothing else of it, as Lens's own query string.
func spendPeriod(r *http.Request) string {
	q := url.Values{}
	for _, k := range []string{"from", "to"} {
		if v := r.URL.Query().Get(k); v != "" {
			q.Set(k, v)
		}
	}
	if len(q) == 0 {
		return ""
	}
	return "?" + q.Encode()
}

func (a *app) handleMoneySpendingMerchants(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w, http.MethodPut)
		return
	}
	var in struct {
		Merchant string `json:"merchant"`
		Category string `json:"category"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensSpendCategoryBody: none
	body, _ := json.Marshal(in)
	a.lensRelay(w, r, t.token, http.MethodPut, "/v1/money/spending/merchants", body, "spend category")
}

func (a *app) handleMoneyCoach(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/coach", nil, "coach")
}

func (a *app) handleMoneyNotices(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/notices", nil, "notices")
}

func (a *app) handleMoneyNoticeSettings(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w, http.MethodPut)
		return
	}
	var in struct {
		Timezone   string   `json:"timezone"`
		QuietFrom  string   `json:"quiet_from"`
		QuietUntil string   `json:"quiet_until"`
		Off        []string `json:"off"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensSpendNoticeSettingsBody: none
	body, _ := json.Marshal(in)
	a.lensRelay(w, r, t.token, http.MethodPut, "/v1/money/notices/settings", body, "notice settings")
}

// B53.16 — the month plan on the Spending screen and Chat's "how much can I spend today?", on this session's own token
// (Lens B53.15).
//
//	GET /api/money/plan          the plan: money now, the upcoming payments, safe to spend per day until payday, and each
//	                             off-plan finding with the Coach's sentence
//	PUT /api/money/plan/income   {payday, amount_minor, currency, payer} — set or confirm the expected income; answers the plan
func (a *app) handleMoneyPlan(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/plan", nil, "month plan")
}

func (a *app) handleMoneyPlanIncome(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w, http.MethodPut)
		return
	}
	var in struct {
		Payday      int    `json:"payday"`
		AmountMinor int64  `json:"amount_minor"`
		Currency    string `json:"currency"`
		Payer       string `json:"payer"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensSpendIncomeBody: confirmed, set_at
	body, _ := json.Marshal(in)
	a.lensRelay(w, r, t.token, http.MethodPut, "/v1/money/plan/income", body, "income")
}
