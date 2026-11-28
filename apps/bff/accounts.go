package main

// accounts.go — B61.8: one person holds several accounts (talyvor-lens B61.7), and a session is on one of them.
//
//	GET  /api/accounts         the signed-in person's accounts, first account first, the current one marked
//	POST /api/accounts/switch  {"account_id"}: the session moves to that account
//	POST /api/accounts         {"type","kind","name","country","registration_number"}: open another, and move to it
//
// LENS SAYS WHICH ACCOUNTS ARE THE PERSON'S. The BFF presents the identity, as it always has, and an account id; Lens
// mints a token for that account only when the identity holds it, and answers 404 otherwise, so no id a client sends
// can reach another person's account. A refused switch leaves the session where it was.
//
// MOVING RE-ISSUES THE SESSION. The session id is a seal of the session (session_seal.go), restored after a restart,
// so an id that kept its old seal would put the person back in the account they left on the next deploy. The browser
// gets a new cookie; the phone, which sends its session as a Bearer token, gets the new token in the answer and
// sends that from then on. The old id is ended.
//
// The token's re-mint (tenant.go refreshWorkspaceToken) asks for the account the session is on, and an assistant's
// connection (Connect, oauth.go) keeps the account it was made in: mcpTenant mints for that account only, whichever
// account the browser is on.
//
// The writes are POSTs under ServeHTTP's same-origin rule (lens.go), like every write here; the phone's Bearer
// session is let through as it is everywhere.

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"slices"
	"time"
)

// personAccount is one row of Lens's list (talyvor-lens internal/workspace PersonAccount).
type personAccount struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Kind     string `json:"kind"`
	OpenedAt string `json:"opened_at"`
	Current  bool   `json:"current"`
	// Role is the role the person holds in an account that is someone else's (B28.70); "" on their own.
	Role string `json:"role,omitempty"`
}

// accountsOf is who is asking: the identity Lens knows them by, the account the session is on, and the session itself
// (with its id) to move. In loopback dev (BFF_AUTH_MODE=disabled) there is no session and the identity is devIdentity.
type accountsOf struct {
	identity string
	current  string
	sid      string
	s        session
	dev      bool
}

func (a *app) accountsCaller(w http.ResponseWriter, r *http.Request) (accountsOf, bool) {
	if a.cfg.authMode == authModeDisabled {
		t, ok := a.devTenant(r.Context())
		if !ok {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
			return accountsOf{}, false
		}
		return accountsOf{identity: devIdentity, current: t.workspaceID, dev: true}, true
	}
	sid, s, ok := a.auth.sessionAndIDFrom(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required — sign in at /signin"})
		return accountsOf{}, false
	}
	return accountsOf{identity: a.identityOf(s.sub), current: s.workspaceID, sid: sid, s: s}, true
}

func (a *app) handleAccounts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.listAccounts(w, r)
	case http.MethodPost:
		a.openAccount(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (a *app) listAccounts(w http.ResponseWriter, r *http.Request) {
	c, ok := a.accountsCaller(w, r)
	if !ok {
		return
	}
	// A test user's workspace came from Lens's synthetic routes, not from provisioning: it is the one account it has.
	if c.s.synthetic {
		writeJSON(w, http.StatusOK, map[string]any{"accounts": []personAccount{{ID: c.current, Current: true}}})
		return
	}
	failed := map[string]string{"error": "could not read your accounts"}
	raw, err := a.provisionPost(r.Context(), c.identity, provisionAsk{mode: "list"}, nil, signupAccount{})
	if err != nil {
		log.Printf("bff: listing accounts failed: %s", redactSecret(err.Error()))
		writeJSON(w, http.StatusBadGateway, failed)
		return
	}
	var got struct {
		Accounts []personAccount `json:"accounts"`
	}
	if err := json.Unmarshal(raw, &got); err != nil || got.Accounts == nil {
		writeJSON(w, http.StatusBadGateway, failed)
		return
	}
	// B28.70: then the accounts a role was given in, to an email the person proved. A failed read leaves them out.
	if emails, err := a.provedEmails(r.Context(), c.s.sub); err != nil {
		log.Printf("bff: reading proved emails failed: %v", err)
	} else if roles, err := a.roleAccounts(r.Context(), c.identity, emails); err != nil {
		log.Printf("bff: reading role accounts failed: %s", redactSecret(err.Error()))
	} else {
		for _, ra := range roles {
			if !slices.ContainsFunc(got.Accounts, func(x personAccount) bool { return x.ID == ra.ID }) {
				got.Accounts = append(got.Accounts, personAccount{ID: ra.ID, Name: ra.Name, Type: ra.Type, Kind: ra.Kind, Role: ra.Role})
			}
		}
	}
	for i := range got.Accounts {
		got.Accounts[i].Current = got.Accounts[i].ID == c.current
	}
	writeJSON(w, http.StatusOK, got)
}

func (a *app) handleAccountSwitch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	c, ok := a.accountsCaller(w, r)
	if !ok {
		return
	}
	var in struct {
		AccountID string `json:"account_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.AccountID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `send {"account_id": "…"}`})
		return
	}
	if c.s.synthetic {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "a test session holds one account"})
		return
	}
	if in.AccountID == c.current {
		writeJSON(w, http.StatusOK, map[string]any{"account_id": c.current})
		return
	}
	prov, err := a.provisionAccount(r.Context(), c.identity, in.AccountID, c.s.signedInAt)
	// B28.70: an account that is not the person's own opens only by a role given to an email they proved.
	if errors.Is(err, errNoSuchAccount) {
		prov, err = a.roleSession(r.Context(), c.identity, c.s.sub, in.AccountID)
	}
	if errors.Is(err, errNoSuchAccount) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such account"})
		return
	}
	if err != nil {
		log.Printf("bff: switching account failed: %s", redactSecret(err.Error()))
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not switch account — try again shortly"})
		return
	}
	a.moveSession(w, r, c, prov)
}

func (a *app) openAccount(w http.ResponseWriter, r *http.Request) {
	c, ok := a.accountsCaller(w, r)
	if !ok {
		return
	}
	var in struct {
		Type               string `json:"type"`
		Kind               string `json:"kind"`
		Name               string `json:"name"`
		Country            string `json:"country"`
		RegistrationNumber string `json:"registration_number"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": errSignupAccount.Error()})
		return
	}
	signup, err := parseSignupAccount(in.Type, in.Kind, in.Name, in.Country, in.RegistrationNumber)
	if err == nil && signup == (signupAccount{}) {
		err = errSignupAccount
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if c.s.synthetic {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "a test session holds one account"})
		return
	}
	prov, err := a.provisionAs(r.Context(), c.identity, provisionAsk{mode: "open", signedInAt: c.s.signedInAt}, nil, signup)
	if err != nil {
		writeProvisionFailed(w, err)
		return
	}
	a.moveSession(w, r, c, prov)
}

// moveSession puts the caller's session on prov's account and answers which account that is. The phone's answer
// carries its new Bearer token.
func (a *app) moveSession(w http.ResponseWriter, r *http.Request, c accountsOf, prov provisionResult) {
	out := map[string]any{"account_id": prov.WorkspaceID, "created": prov.Created}
	if c.dev {
		a.devMu.Lock()
		a.devCached = tenant{workspaceID: prov.WorkspaceID, token: prov.Token}
		a.devMu.Unlock()
		writeJSON(w, http.StatusOK, out)
		return
	}
	next := c.s
	next.workspaceID, next.lensToken, next.lensTokenExp = prov.WorkspaceID, prov.Token, parseExpiry(prov.ExpiresAt)
	next.cachePoolable, next.needsPoolingChoice = prov.CachePoolable, prov.Created
	next.role, next.roleEmail = prov.Role, prov.roleEmail
	if _, _, bearer := a.auth.bearerSession(r); bearer {
		sid, err := a.auth.storeSession(next)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
			return
		}
		a.auth.endSession(c.sid)
		out["token"], out["expires_at"] = sid, next.expires.UTC().Format(time.RFC3339)
		w.Header().Set("Cache-Control", "no-store")
	} else if err := a.startSession(w, r, next, int(time.Until(next.expires).Seconds())); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	a.lastAccounts.Store(c.identity, prov.WorkspaceID)
	log.Printf("bff: session for sub=%s moved to account %s", next.sub, prov.WorkspaceID)
	writeJSON(w, http.StatusOK, out)
}

// writeProvisionFailed answers a sign-up's or an open's failed provisioning: Lens's own sentence when it worded the
// refusal for the person (the eleventh account), and otherwise the upstream fault it is.
func writeProvisionFailed(w http.ResponseWriter, err error) {
	var refused provisionRefused
	if errors.As(err, &refused) {
		writeJSON(w, refused.status, refusalBody(refused.msg, refused.code, refused.field))
		return
	}
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not provision your workspace — try again shortly"})
}
