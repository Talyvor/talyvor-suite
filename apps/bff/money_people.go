package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// money_people.go — B61.33: Pay, to a person on Talyvor, found by their Talyvor name, phone number or email (Lens
// B61.32), on this session's own token:
//
//	POST /api/money/people/find {to}   the person's shown name (first name and the last name's initial) and nothing
//	                          else, or Lens's one answer for nobody found (404); 429 at the account's limit an hour
//	POST /api/money/people/pay/challenge {to, amount_minor, currency, account_id, note, idempotency_key}   the
//	                          challenge the payment, as it will be sent, is signed over
//	POST /api/money/people/pay {the same payment, assertion}   pay the person once under the key, from the account's own
//	                          account in that currency, signed by one of its passkeys or the phone app's key; the first
//	                          payment to a person is refused unsigned whatever the account holds
//
// Lens decides everything: who is found, the account it arrives in, the limit of lookups, the first payment's key,
// screening and freezes. funding is never sent, so Lens pays test money until its capability is cleared for live money;
// a refusal comes back with its sentence (lensRelay).

// handleMoneyPeopleFind — POST /api/money/people/find {to}.
func (a *app) handleMoneyPeopleFind(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		To string `json:"to"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensPersonFindBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/people/find", body)
}

// handleMoneyPeoplePay — POST /api/money/people/pay pays the person; POST /api/money/people/pay/challenge relays the
// payment as it will be sent, without the signature, for the challenge it is signed over.
func (a *app) handleMoneyPeoplePay(challenge bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		var in struct {
			To             string          `json:"to"`
			AmountMinor    int64           `json:"amount_minor"`
			Currency       string          `json:"currency"`
			AccountID      string          `json:"account_id"`
			Note           string          `json:"note"`
			IdempotencyKey string          `json:"idempotency_key"`
			Assertion      json.RawMessage `json:"assertion,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		path := "/v1/money/people/pay"
		if challenge {
			in.Assertion, path = nil, path+"/challenge"
		}
		// UPSTREAM-BINDS-ONLY lensPersonPaymentBody: funding
		body, _ := json.Marshal(in)
		a.agentBankRelayPath(w, r, t, http.MethodPost, path, body)
	}
}
