package main

import (
	"encoding/json"
	"net/http"
)

// workspace_account.go — B59.10: the session's workspace's type and kind of money.
//
//	GET /api/workspace/account → GET /v1/workspaces/{ws}/account   {"account_type", "money_kind"}, as Lens answers it (B59.6)
//
// The web renders Home, Pay, Cards, Wallets and Settings by these two words (SPEC 3.3 and 3.4). Changing the kind is
// not here: this route only reads.
//
// The workspace is the session's (lensWorkspacePath), never one the request names. A type or kind Lens does not name
// is a failed read, never passed on: the web must not draw a screen by a word it has no rule for.
func (a *app) handleWorkspaceAccount(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	failed := map[string]string{"error": "could not read this workspace's account"}
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/account"))
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), failed)
		return
	}
	var got struct {
		AccountType string `json:"account_type"`
		MoneyKind   string `json:"money_kind"`
	}
	if err := json.Unmarshal(raw, &got); err != nil ||
		(got.AccountType != "business" && got.AccountType != "personal") ||
		(got.MoneyKind != "fiat" && got.MoneyKind != "stablecoin" && got.MoneyKind != "hybrid") {
		writeJSON(w, http.StatusBadGateway, failed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"account_type": got.AccountType, "money_kind": got.MoneyKind})
}
