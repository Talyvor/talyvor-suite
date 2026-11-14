package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// money_wallets.go — B59.52: Wallets' top up, withdraw and convert, for the web and the phone (Lens B17.255 and B59.51),
// on this session's own token:
//
//	POST /api/money/accounts/{id}/top-up {amount_minor}   Sandbox money into one of the company's accounts, once under the
//	                          Idempotency-Key header (Lens reads it from the body, so it goes up there as well)
//	POST /api/money/accounts/{id}/withdraw/challenge {payee_id, amount_minor}   the challenge withdrawing that amount to
//	                          the owner's own bank is signed over, under the same Idempotency-Key header as the withdraw
//	POST /api/money/accounts/{id}/withdraw {payee_id, amount_minor, assertion}   pay it out to a bank saved as the
//	                          owner's own; "assertion" is the passkey's or the phone's signature, sent up exactly as it came
//	POST /api/money/convert/quote {sell_currency, buy_currency, sell_minor}   a currency for USDC or USDC for a currency,
//	                          between the company's accounts on the two sides, good until expires_at
//	POST /api/money/convert/challenge {quote_id}   the challenge converting at it is signed over, under the Idempotency-Key
//	POST /api/money/convert {quote_id, assertion}   convert at the quote, once under the Idempotency-Key header
//
// Lens decides everything: whose account it is (another workspace's is not found), that only the owner or an admin may
// move it, whether a signature is needed, and the kind of money (a workspace that is not Hybrid is refused 409
// wrong_money_kind). A refusal comes back with its sentence, code and field (instantRelay), because the screen picks its
// words from the field. Funding is never named: Lens moves test money until its capability is cleared for live money.

// handleMoneyAccountTopUp — POST /api/money/accounts/{id}/top-up.
func (a *app) handleMoneyAccountTopUp(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "account id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		AmountMinor    int64  `json:"amount_minor"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if k := r.Header.Get("Idempotency-Key"); k != "" && len(k) <= 128 {
		in.IdempotencyKey = k
	}
	// UPSTREAM-BINDS-ONLY lensTestMoneyBody: none
	body, _ := json.Marshal(in)
	a.instantRelay(w, r, t, http.MethodPost, "/v1/money/accounts/"+url.PathEscape(id)+"/test-money", body)
}

// handleMoneyAccountWithdraw — POST /api/money/accounts/{id}/withdraw, and its /challenge.
func (a *app) handleMoneyAccountWithdraw(challenge bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "account id", r.PathValue("id"))
		if !ok {
			return
		}
		var in struct {
			PayeeID     string          `json:"payee_id"`
			AmountMinor int64           `json:"amount_minor"`
			Assertion   json.RawMessage `json:"assertion,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		path := "/v1/money/accounts/" + url.PathEscape(id) + "/withdraw"
		if challenge {
			in.Assertion, path = nil, path+"/challenge"
		}
		// The key a retry sends again under rides in the Idempotency-Key header, which Lens reads over the body's.
		// UPSTREAM-BINDS-ONLY lensWithdrawBody: account_id, funding, idempotency_key
		body, _ := json.Marshal(in)
		a.instantRelay(w, r, t, http.MethodPost, path, body)
	}
}

// handleMoneyConvertQuote — POST /api/money/convert/quote.
func (a *app) handleMoneyConvertQuote(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		SellCurrency string `json:"sell_currency"`
		BuyCurrency  string `json:"buy_currency"`
		SellMinor    int64  `json:"sell_minor"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensSideConvertQuoteBody: agent_id, buy_minor, converted_at, created_at, entry_id, expires_at, from_account_id, funding, id, idempotency_key, margin_bps, margin_minor, partner, rate, reference_rate, status, to_account_id, value_ulxc, workspace_id
	body, _ := json.Marshal(in)
	a.instantRelay(w, r, t, http.MethodPost, "/v1/money/convert/quote", body)
}

// handleMoneyConvert — POST /api/money/convert, and its /challenge.
func (a *app) handleMoneyConvert(challenge bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		var in struct {
			QuoteID   string          `json:"quote_id"`
			Assertion json.RawMessage `json:"assertion,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		path := "/v1/money/convert"
		if challenge {
			in.Assertion, path = nil, path+"/challenge"
		}
		// UPSTREAM-BINDS-ONLY lensSideConvertBody: idempotency_key
		body, _ := json.Marshal(in)
		a.instantRelay(w, r, t, http.MethodPost, path, body)
	}
}
