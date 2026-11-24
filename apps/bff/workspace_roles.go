package main

// workspace_roles.go — B28.70: the owner gives people a role in the workspace (Viewer, Finance, Approver, Admin), and
// a person signs in to a workspace they hold a role in. Lens (B28.342) keeps the roles and decides on every request
// what a role may do; the BFF relays and proves the email:
//
//	GET    /api/workspace/roles                 {"items": [{email, role, signed_in, granted_at}], "roles": [...]}
//	PUT    /api/workspace/roles                 {"email", "role"}: give an email a role, or change it
//	DELETE /api/workspace/roles?email=…         take it away: every session it gave ends at once
//	POST   /api/roles/email/code                {"email"}: a code is mailed to it
//	POST   /api/roles/email/check               {"email", "code"}: the email is proved for this person
//	GET    /api/roles                           {"emails": [proved], "accounts": [the accounts a role was given in]}
//
// The owner's three go on the session's own token; Lens answers them to the owner's session only.
//
// A ROLE IS GIVEN TO AN EMAIL, SO LENS IS TOLD ONLY AN EMAIL THE PERSON PROVED. Lens's POST /v1/provision/roles takes
// the email on trust (talyvor-lens workspace_roles_handler.go): whoever names it holds the role. So the BFF sends it
// only an address the person proved with a code mailed to it, in this sign-in or an earlier one, and never one they
// typed and did not prove, nor the session's own email, which no code proved. An address someone typed and could not
// prove shows no role and opens no session.
//
// THE ACCOUNTS SWITCHER CARRIES THEM. GET /api/accounts lists the role accounts after the person's own, each with its
// role, and POST /api/accounts/switch opens one with a role session (accounts.go); the token's re-mint asks for it
// again by the same proved email (tenant.go refreshWorkspaceToken), so a role taken away is not re-minted.
//
// The proved addresses live in person_proved_emails when BFF_DATABASE_URL is set, and in memory otherwise. A code is
// kept in memory for roleCodeLife, tried at most roleCodeTries times, and mailed at most once per roleCodeGap.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	workspaceRolesPath = "/roles"
	provisionRolesPath = "/v1/provision/roles"

	roleCodeLife  = 10 * time.Minute
	roleCodeTries = 5
	roleCodeGap   = 30 * time.Second
	// roleCodesAnHour is how many codes go in an hour to one person, and to one address whoever asks: with
	// roleCodeTries each, an address's code can be guessed at most 25 times an hour out of a million.
	roleCodesAnHour = 5

	roleCodeSubject = "Your Talyvor code"
)

// roleCodeMail is the mail that carries a code.
func roleCodeMail(code string) string {
	return "Your code is " + code + ". It works for 10 minutes.\n\nIf you did not ask for it, you can ignore this email."
}

// roleAccount is one account a person holds a role in (talyvor-lens workspace.RoleAccount), and the proved email the
// role was given to.
type roleAccount struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Type  string `json:"type"`
	Kind  string `json:"kind"`
	Role  string `json:"role"`
	email string
}

// roleCode is the code mailed to one address for one person.
type roleCode struct {
	email   string
	hash    [32]byte
	expires time.Time
	tries   int
}

// roleProofs keeps the codes waiting, by sub, the times codes were sent, by "sub:" and "email:" (kept apart from the
// codes, so a code used up or refused does not reset the hour), and the proved addresses when there is no database.
type roleProofs struct {
	mu     sync.Mutex
	codes  map[string]roleCode
	sent   map[string][]time.Time
	proved map[string][]string
}

// lastHour is the times under key in the hour before now, pruned. The caller holds mu.
func (p *roleProofs) lastHour(key string, now time.Time) []time.Time {
	kept := p.sent[key][:0]
	for _, at := range p.sent[key] {
		if now.Sub(at) < time.Hour {
			kept = append(kept, at)
		}
	}
	if len(kept) == 0 {
		delete(p.sent, key)
		return nil
	}
	p.sent[key] = kept
	return kept
}

// roleEmailChars are the characters a role's address may hold. A code is mailed to it, so the address is rebuilt from
// these alone, never passed on as typed, and nothing the person types reaches a mail's headers.
const roleEmailChars = "abcdefghijklmnopqrstuvwxyz0123456789.@_+-"

// roleEmail is an address as the person typed it, lower-cased, or "" when it is not one plain address of
// roleEmailChars.
func roleEmail(s string) string {
	e := strings.ToLower(strings.TrimSpace(s))
	if !plainAddress(e) {
		return ""
	}
	out := make([]byte, 0, len(e))
	for i := 0; i < len(e); i++ {
		k := strings.IndexByte(roleEmailChars, e[i])
		if k < 0 {
			return ""
		}
		out = append(out, roleEmailChars[k])
	}
	return string(out)
}

// handleWorkspaceRoles — the owner's roles: GET lists them, PUT gives one, DELETE takes one away.
func (a *app) handleWorkspaceRoles(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, workspaceRolesPath, nil)
	case http.MethodPut:
		var in struct {
			Email string `json:"email"`
			Role  string `json:"role"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensWorkspaceRoleBody: none
		body, _ := json.Marshal(map[string]string{"email": strings.TrimSpace(in.Email), "role": in.Role})
		a.agentBankRelay(w, r, t, http.MethodPut, workspaceRolesPath, body)
	case http.MethodDelete:
		a.agentBankRelay(w, r, t, http.MethodDelete, workspaceRolesPath+"?"+url.Values{"email": {r.URL.Query().Get("email")}}.Encode(), nil)
	default:
		methodNotAllowed(w, "GET, PUT, DELETE")
	}
}

// handleRoleEmailCode — POST {"email"}: a code is mailed to the address, for this session's person to prove it.
func (a *app) handleRoleEmailCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	c, ok := a.accountsCaller(w, r)
	if !ok {
		return
	}
	var in struct {
		Email string `json:"email"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in)
	email := roleEmail(in.Email)
	switch {
	case email == "":
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Enter one email address."})
		return
	case c.s.synthetic || c.dev || c.s.sub == "":
		writeJSON(w, http.StatusConflict, map[string]string{"error": "a test session holds one account"})
		return
	case a.mail == nil:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Talyvor can’t send a code by email just now."})
		return
	}
	code, err := sixDigits()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	now := time.Now()
	a.roles.mu.Lock()
	if a.roles.codes == nil {
		a.roles.codes, a.roles.sent = map[string]roleCode{}, map[string][]time.Time{}
	}
	bySub, byEmail := a.roles.lastHour("sub:"+c.s.sub, now), a.roles.lastHour("email:"+email, now)
	if len(bySub) >= roleCodesAnHour || len(byEmail) >= roleCodesAnHour {
		a.roles.mu.Unlock()
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many codes asked for. Try again in an hour."})
		return
	}
	if len(bySub) > 0 && now.Sub(bySub[len(bySub)-1]) < roleCodeGap {
		a.roles.mu.Unlock()
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Wait a moment before asking for another code."})
		return
	}
	a.roles.sent["sub:"+c.s.sub] = append(bySub, now)
	a.roles.sent["email:"+email] = append(byEmail, now)
	a.roles.codes[c.s.sub] = roleCode{email: email, hash: sha256.Sum256([]byte(code)), expires: now.Add(roleCodeLife)}
	a.roles.mu.Unlock()
	if err := a.mail.send(r.Context(), email, roleCodeSubject, roleCodeMail(code)); err != nil {
		log.Printf("bff: a role email code for sub=%s was not sent: %v", c.s.sub, err)
		a.roles.mu.Lock()
		delete(a.roles.codes, c.s.sub)
		a.roles.mu.Unlock()
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "That email didn’t send. Try again."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sent": true, "email": email})
}

// handleRoleEmailCheck — POST {"email", "code"}: the code mailed to the address proves it for this session's person.
func (a *app) handleRoleEmailCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	c, ok := a.accountsCaller(w, r)
	if !ok {
		return
	}
	var in struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in)
	email, code := roleEmail(in.Email), strings.TrimSpace(in.Code)
	wrong := map[string]string{"error": "That code isn’t right, or it has run out. Ask for a new one."}
	if email == "" || code == "" || c.s.sub == "" {
		writeJSON(w, http.StatusBadRequest, wrong)
		return
	}
	a.roles.mu.Lock()
	got, ok := a.roles.codes[c.s.sub]
	match := false
	if ok {
		got.tries++
		h := sha256.Sum256([]byte(code))
		match = got.email == email && time.Now().Before(got.expires) && got.tries <= roleCodeTries && subtle.ConstantTimeCompare(h[:], got.hash[:]) == 1
		if match || got.tries >= roleCodeTries || !time.Now().Before(got.expires) {
			delete(a.roles.codes, c.s.sub)
		} else {
			a.roles.codes[c.s.sub] = got
		}
	}
	a.roles.mu.Unlock()
	if !match {
		writeJSON(w, http.StatusBadRequest, wrong)
		return
	}
	if err := a.proveEmail(r.Context(), c.s.sub, email); err != nil {
		log.Printf("bff: a proved email of sub=%s could not be kept: %v", c.s.sub, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "That didn’t work just now. Try again."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": email})
}

// handleRoles — GET: the person's proved addresses and every account a role was given to one of them in.
func (a *app) handleRoles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	c, ok := a.accountsCaller(w, r)
	if !ok {
		return
	}
	emails, err := a.provedEmails(r.Context(), c.s.sub)
	if err == nil {
		var accounts []roleAccount
		if accounts, err = a.roleAccounts(r.Context(), c.identity, emails); err == nil {
			out := make([]map[string]any, 0, len(accounts))
			for _, ra := range accounts {
				out = append(out, map[string]any{"id": ra.ID, "name": ra.Name, "type": ra.Type, "kind": ra.Kind, "role": ra.Role,
					"email": ra.email, "current": ra.ID == c.current})
			}
			writeJSON(w, http.StatusOK, map[string]any{"emails": emails, "accounts": out})
			return
		}
	}
	log.Printf("bff: reading roles failed: %s", redactSecret(err.Error()))
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not read your roles"})
}

// sixDigits is a code of six digits from crypto/rand.
func sixDigits() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// proveEmail keeps email as proved by sub.
func (a *app) proveEmail(ctx context.Context, sub, email string) error {
	if a.oauth != nil && a.oauth.db != nil {
		_, err := a.oauth.db.pool.Exec(ctx, `INSERT INTO person_proved_emails (sub, email, proved_at) VALUES ($1, $2, now())
			ON CONFLICT (sub, email) DO UPDATE SET proved_at = EXCLUDED.proved_at`, sub, email)
		return err
	}
	a.roles.mu.Lock()
	defer a.roles.mu.Unlock()
	if a.roles.proved == nil {
		a.roles.proved = map[string][]string{}
	}
	if !slices.Contains(a.roles.proved[sub], email) {
		a.roles.proved[sub] = append(a.roles.proved[sub], email)
	}
	return nil
}

// provedEmails are the addresses sub proved, oldest first.
func (a *app) provedEmails(ctx context.Context, sub string) ([]string, error) {
	if sub == "" {
		return []string{}, nil
	}
	if a.oauth != nil && a.oauth.db != nil {
		rows, err := a.oauth.db.pool.Query(ctx, `SELECT email FROM person_proved_emails WHERE sub = $1 ORDER BY proved_at, email`, sub)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := []string{}
		for rows.Next() {
			var e string
			if err := rows.Scan(&e); err != nil {
				return nil, err
			}
			out = append(out, e)
		}
		return out, rows.Err()
	}
	a.roles.mu.Lock()
	defer a.roles.mu.Unlock()
	return append([]string{}, a.roles.proved[sub]...), nil
}

// roleAccounts asks Lens, for each proved email, which accounts it holds a role in: each account once, by the first
// email that holds one there.
func (a *app) roleAccounts(ctx context.Context, identity string, emails []string) ([]roleAccount, error) {
	out := []roleAccount{}
	for _, email := range emails {
		var got struct {
			Accounts []roleAccount `json:"accounts"`
		}
		// UPSTREAM-BINDS-ONLY lensProvisionRolesBody: none
		status, raw, err := a.provisionSecretPost(ctx, provisionRolesPath, map[string]string{"identity": identity, "email": email, "mode": "list"})
		if err == nil && status != http.StatusOK {
			err = fmt.Errorf("lens %s answered %d", provisionRolesPath, status)
		}
		if err == nil {
			err = json.Unmarshal(raw, &got)
		}
		if err != nil {
			return nil, err
		}
		for _, ra := range got.Accounts {
			if !slices.ContainsFunc(out, func(x roleAccount) bool { return x.ID == ra.ID }) {
				ra.email = email
				out = append(out, ra)
			}
		}
	}
	return out, nil
}

// roleSession mints a role session for accountID by one of sub's proved emails: errNoSuchAccount when none of them
// holds a role there.
func (a *app) roleSession(ctx context.Context, identity, sub, accountID string) (provisionResult, error) {
	emails, err := a.provedEmails(ctx, sub)
	if err != nil {
		return provisionResult{}, err
	}
	for _, email := range emails {
		prov, err := a.roleSessionBy(ctx, identity, email, accountID)
		if errors.Is(err, errNoSuchAccount) {
			continue
		}
		return prov, err
	}
	return provisionResult{}, errNoSuchAccount
}

// roleSessionBy mints a role session for accountID by email, which must be one sub proved.
func (a *app) roleSessionBy(ctx context.Context, identity, email, accountID string) (provisionResult, error) {
	var got struct {
		WorkspaceID string `json:"workspace_id"`
		Role        string `json:"role"`
		Token       string `json:"token"`
		ExpiresAt   string `json:"expires_at"`
	}
	// UPSTREAM-BINDS-ONLY lensProvisionRoleSessionBody: none
	status, raw, err := a.provisionSecretPost(ctx, provisionRolesPath, map[string]any{"identity": identity, "email": email,
		"mode": "session", "account_id": accountID, "ttl_hours": sessionTokenTTLHours})
	switch {
	case err != nil:
		return provisionResult{}, err
	// 404: no role for this email there; 409: someone else took the role up first (Lens binds it to them).
	case status == http.StatusNotFound || status == http.StatusConflict:
		return provisionResult{}, errNoSuchAccount
	case status != http.StatusOK:
		return provisionResult{}, fmt.Errorf("lens %s answered %d", provisionRolesPath, status)
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		return provisionResult{}, err
	}
	if got.WorkspaceID != accountID || got.Token == "" || got.Role == "" {
		return provisionResult{}, fmt.Errorf("lens %s: asked for account %s, answered %q", provisionRolesPath, accountID, got.WorkspaceID)
	}
	return provisionResult{WorkspaceID: got.WorkspaceID, Token: got.Token, ExpiresAt: got.ExpiresAt, Role: got.Role, roleEmail: email}, nil
}
