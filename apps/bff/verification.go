package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// verification.go — B30.116: the owner's verification levels (Lens B30.4), reached with this session's own token:
//
//	GET  /api/verification                                    the level, the live level and every check
//	POST /api/verification/contact   {email, phone}           L1: email and phone confirmed
//	POST /api/verification/identity  {name, country, date_of_birth, address?}
//	                                                          L2: identity checked; address is the home address
//	                                                          {lines, town, postcode, country} (Lens B61.45)
//	POST /api/verification/company   {name, country, company_number, directors, people_with_significant_control}
//	                                                          L3: company checked
//
// Lens decides everything: the order (a check before the level below it is a 409 naming that level), the
// provider that checks, and what a Test provider's pass counts for. Each answers 201 with the check and the
// record, and a refusal comes back with its sentence (agentBankRelay). Every body is rebuilt from the fields its
// own check confirms, so a contact check never carries a name and an identity check never a phone number. The
// level each capability needs for live money is level_needed on GET /api/wallets/capabilities (wallet_money.go).
//
// B65.2 — the GET's ?return_to= and the identity check's return_to name the page the identity partner's own page
// (Persona's) sends the person back to: "signup" for sign-up's last step, "settings" for Settings, Verification, and
// (B65.4) "phone" for the phone app's own identity step. Only those names reach Lens (Lens B65.1 keeps the addresses);
// anything else is dropped, and Lens sends them to Settings.

// checkReturnName is name when it is one of Lens's return names, else "".
func checkReturnName(name string) string {
	if name == "signup" || name == "settings" || name == "phone" {
		return name
	}
	return ""
}

// handleVerification — GET /api/verification.
func (a *app) handleVerification(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix := "/verification"
	if to := checkReturnName(r.URL.Query().Get("return_to")); to != "" {
		suffix += "?" + url.Values{"return_to": {to}}.Encode()
	}
	a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
}

// handleVerificationContact — POST /api/verification/contact: the email and phone check (L1).
func (a *app) handleVerificationContact(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Email string `json:"email"`
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensVerificationContactBody: address, company_number, country, date_of_birth, directors, name, people_with_significant_control
	body, _ := json.Marshal(in)
	rec := &relayStatus{ResponseWriter: w}
	a.agentBankRelay(rec, r, t, http.MethodPost, "/verification/contact", body)
	// B61.91: an address Lens took for this check is one a move of the person's number tells (number_moves.go).
	if sub, ok := a.subOf(t.person); ok && rec.code/100 == 2 {
		a.rememberEmail(r.Context(), sub, in.Email)
	}
}

// homeAddress — B61.46: the person's home address for an identity check (Lens economy.HomeAddress, B61.45), sent whole
// or not at all: Lens refuses one without its lines, town, postcode or country.
type homeAddress struct {
	Lines    []string `json:"lines"`
	Town     string   `json:"town"`
	Postcode string   `json:"postcode"`
	Country  string   `json:"country"`
}

// handleVerificationIdentity — POST /api/verification/identity: the identity check (L2).
func (a *app) handleVerificationIdentity(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Name        string       `json:"name"`
		Country     string       `json:"country"`
		DateOfBirth string       `json:"date_of_birth"`
		Address     *homeAddress `json:"address,omitempty"`
		ReturnTo    string       `json:"return_to,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	in.ReturnTo = checkReturnName(in.ReturnTo)
	// UPSTREAM-BINDS-ONLY lensVerificationIdentityBody: company_number, directors, email, people_with_significant_control, phone
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, "/verification/identity", body)
}

// handleVerificationCompany — POST /api/verification/company: the company check (L3).
func (a *app) handleVerificationCompany(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Name               string   `json:"name"`
		Country            string   `json:"country"`
		CompanyNumber      string   `json:"company_number"`
		Directors          []string `json:"directors"`
		SignificantControl []string `json:"people_with_significant_control"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensVerificationCompanyBody: address, date_of_birth, email, phone
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, "/verification/company", body)
}
