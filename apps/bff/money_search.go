package main

import (
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
