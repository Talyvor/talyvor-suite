package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// money_pay.go — B30.96: the Pay screen — saved payees (Lens B30.16), payments out (B30.17), mandates (B30.19) and bulk
// payouts (B30.21), on this session's own token; standing orders go through the agent schedules in agent_bank.go (B30.18).
//
//	GET  /api/money/payees                          the saved payees outside Talyvor, each with what its bank said of the name
//	POST /api/money/payees   {name, country, sort_code, account_number, iban, bic, routing_number}   save one; Lens checks the name
//	POST /api/money/payees/{id}/challenge           the challenge a close or no match is confirmed over
//	POST /api/money/payees/{id}/confirm {assertion} confirm it with one of the workspace's passkeys
//	POST /api/money/payees/{id}/called/challenge    B41.11: the challenge the owner signs to say they called a new payee
//	POST /api/money/payees/{id}/called {assertion}  they called it on a number they already had: its cooling-off ends
//	POST /api/money/payees/{id}/details/challenge {country, sort_code, account_number, iban, bic, routing_number, network,
//	                          address}   B41.12: the challenge changing its bank details to these is signed over
//	POST /api/money/payees/{id}/details {the same details, assertion}   change them with a passkey: Lens checks the name
//	                          afresh and holds every payment to it for 24 hours (held_until), with its notice
//	GET  /api/money/payments                        the payments out, newest first
//	POST /api/money/payments {account_id, payee_id, amount_minor, currency, reference, idempotency_key, assertion}   pay a
//	                          saved payee; B54.35: "assertion" is the passkey's or the phone's signature over the challenge
//	POST /api/money/payments/challenge {the payment, as it will be sent}   B54.35: the challenge it is signed over
//	GET  /api/money/mandates                        the mandates granted and, for the owner, received
//	POST /api/money/mandates {account_id, payee_workspace_id | payee_business_id + payee_id, payee_name, max_per_pull_minor,
//	                          max_per_month_minor, expires_at}   grant one from an agent's account
//	POST /api/money/mandates/{id}/revoke            revoke it, for good
//	GET  /api/money/payouts                         the payout batches, newest first
//	POST /api/money/payouts  (text/csv)             up to 1,000 payouts, validated row by row and held for one approval; the
//	                                                Idempotency-Key header goes up with the file
//	GET  /api/money/payouts/{id}                    one batch with every row's result
//	POST /api/money/payouts/{id}/approve            pay every valid row, once
//
// Lens decides everything: who may pay from which account, the agent's rules, screening, what each row is worth and what
// posts. A refusal comes back with its sentence (lensRelay). Funding is never named here: Lens takes test money until its
// capability is cleared for live money.

// handleMoneyPayees — GET /api/money/payees lists them; POST saves one.
func (a *app) handleMoneyPayees(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/payees", nil)
	case http.MethodPost:
		var in struct {
			Name          string `json:"name"`
			Country       string `json:"country"`
			SortCode      string `json:"sort_code"`
			AccountNumber string `json:"account_number"`
			IBAN          string `json:"iban"`
			BIC           string `json:"bic"`
			RoutingNumber string `json:"routing_number"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPayeeCreateBody: check, checked_at, checked_by, confirmed_at, confirmed_by, created_at, id, needs_confirmation, screening, suggested_name, workspace_id
		body, _ := json.Marshal(in)
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/payees", body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyPayeeChallenge — POST /api/money/payees/{id}/challenge: the challenge the owner's passkey signs to confirm it.
func (a *app) handleMoneyPayeeChallenge(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "payee id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/payees/"+url.PathEscape(id)+"/challenge", nil)
}

// handleMoneyPayeeConfirm — POST /api/money/payees/{id}/confirm {assertion}: a close or no match, confirmed with a passkey.
func (a *app) handleMoneyPayeeConfirm(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "payee id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Assertion *passkeyAssertion `json:"assertion"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Assertion == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a payee is confirmed with a passkey's assertion"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensPayeeConfirmBody: none
	body, _ := json.Marshal(map[string]*passkeyAssertion{"assertion": in.Assertion})
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/payees/"+url.PathEscape(id)+"/confirm", body)
}

// handleMoneyPayeeCalled — B41.11: POST /api/money/payees/{id}/called/challenge relays the challenge, and
// POST /api/money/payees/{id}/called {assertion} the owner's passkey saying they called the new payee on a number they
// already had (Lens B41.111): its 24-hour cooling-off ends and the payments it held are paid.
func (a *app) handleMoneyPayeeCalled(challenge bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "payee id", r.PathValue("id"))
		if !ok {
			return
		}
		path := "/v1/money/payees/" + url.PathEscape(id) + "/called"
		if challenge {
			a.agentBankRelayPath(w, r, t, http.MethodPost, path+"/challenge", nil)
			return
		}
		var in struct {
			Assertion *passkeyAssertion `json:"assertion"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Assertion == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a call to a new payee is confirmed with a passkey's assertion"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPayeeCalledBody: none
		body, _ := json.Marshal(map[string]any{"assertion": in.Assertion})
		a.agentBankRelayPath(w, r, t, http.MethodPost, path, body)
	}
}

// handleMoneyPayeeDetails — B41.12: POST /api/money/payees/{id}/details/challenge relays the challenge for the new bank
// details, and POST /api/money/payees/{id}/details {details, assertion} changes them with the owner's passkey (Lens
// B41.112): the name is checked afresh and every payment to the payee is held for 24 hours.
func (a *app) handleMoneyPayeeDetails(challenge bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "payee id", r.PathValue("id"))
		if !ok {
			return
		}
		var in struct {
			Country       string            `json:"country"`
			SortCode      string            `json:"sort_code"`
			AccountNumber string            `json:"account_number"`
			IBAN          string            `json:"iban"`
			BIC           string            `json:"bic"`
			RoutingNumber string            `json:"routing_number"`
			Network       string            `json:"network"`
			Address       string            `json:"address"`
			Assertion     *passkeyAssertion `json:"assertion,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		path := "/v1/money/payees/" + url.PathEscape(id) + "/details"
		if challenge {
			in.Assertion, path = nil, path+"/challenge"
		} else if in.Assertion == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a payee's bank details are changed with a passkey's assertion"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPayeeDetailsBody: called_at, called_by, check, checked_at, checked_by, confirmed_at, confirmed_by, cooling_off_until, created_at, details_changed_at, held_until, id, name, needs_confirmation, notice, screening, suggested_name, workspace_id
		body, _ := json.Marshal(in)
		a.agentBankRelayPath(w, r, t, http.MethodPost, path, body)
	}
}

// handleMoneyPayments — GET /api/money/payments lists the payments out; POST pays a saved payee. B54.35: once the
// workspace has a passkey or a device key, Lens pays a person's payment only with "assertion", that key's signature over
// the payment's own challenge (Lens B54.33), so it goes up exactly as sent, a passkey's or the phone's; and
// POST /api/money/payments/challenge relays the payment as it will be sent for that challenge.
func (a *app) handleMoneyPayments(challenge bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		switch {
		case r.Method == http.MethodGet && !challenge:
			a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/payments", nil)
		case r.Method == http.MethodPost:
			var in struct {
				AccountID      string          `json:"account_id"`
				PayeeID        string          `json:"payee_id"`
				AmountMinor    int64           `json:"amount_minor"`
				Currency       string          `json:"currency"`
				Reference      string          `json:"reference"`
				IdempotencyKey string          `json:"idempotency_key"`
				Assertion      json.RawMessage `json:"assertion,omitempty"`
			}
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
				return
			}
			path := "/v1/money/payments"
			if challenge {
				in.Assertion, path = nil, path+"/challenge"
			}
			// UPSTREAM-BINDS-ONLY lensMoneyPaymentBody: agent_id, created_at, detail, funding, id, partner, partner_ref, payee_name, status, updated_at, value_ulxc, workspace_id
			body, _ := json.Marshal(in)
			a.agentBankRelayPath(w, r, t, http.MethodPost, path, body)
		case challenge:
			methodNotAllowed(w, http.MethodPost)
		default:
			methodNotAllowed(w, "GET, POST")
		}
	}
}

// handleMoneyMandates — GET /api/money/mandates lists those granted and received; POST grants one.
func (a *app) handleMoneyMandates(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/mandates", nil)
	case http.MethodPost:
		var in struct {
			AccountID        string `json:"account_id"`
			PayeeWorkspaceID string `json:"payee_workspace_id"`
			PayeeBusinessID  string `json:"payee_business_id"`
			PayeeID          string `json:"payee_id"`
			PayeeName        string `json:"payee_name"`
			MaxPerPullMinor  int64  `json:"max_per_pull_minor"`
			MaxPerMonthMinor int64  `json:"max_per_month_minor"`
			ExpiresAt        string `json:"expires_at"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensMandateGrantBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/mandates", body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyMandateRevoke — POST /api/money/mandates/{id}/revoke.
func (a *app) handleMoneyMandateRevoke(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "mandate id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/mandates/"+url.PathEscape(id)+"/revoke", nil)
}

// handleMoneyPayouts — GET /api/money/payouts lists the batches; POST uploads one as CSV, which Lens parses and validates
// row by row (payee_id, amount, currency, reference). The file goes up as it came, as text/csv, under the browser's
// Idempotency-Key: Lens reads only the named columns and answers a file it cannot read with its sentence.
func (a *app) handleMoneyPayouts(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/payouts", nil)
	case http.MethodPost:
		csv, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil || len(csv) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the CSV is empty"})
			return
		}
		a.lensRelayTyped(w, r, t.token, http.MethodPost, "/v1/money/payouts", csv, "text/csv", "payouts upload")
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyPayout — GET /api/money/payouts/{id}: one batch with every row.
func (a *app) handleMoneyPayout(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "batch id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/payouts/"+url.PathEscape(id), nil)
}

// handleMoneyPayoutApprove — POST /api/money/payouts/{id}/approve: every valid row is paid, once.
func (a *app) handleMoneyPayoutApprove(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "batch id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/payouts/"+url.PathEscape(id)+"/approve", nil)
}
