package main

// phone_signin.go — B61.25: the front door by phone number, the passcode and the passkey (talyvor-lens B61.22, B61.23,
// B61.24), and the phone app's lock. It is the only way in: Google sign-in is gone (B61.29).
//
//	POST /auth/phone/start   {phone}                          a texted code; in Sandbox the code itself, for the screen
//	POST /auth/phone/finish  {phone, code}                    a right code: a check, and whether a person holds the number
//	POST /auth/phone/signin  {check, passcode, account_id?}   a known number and its passcode: a session
//	POST /auth/phone/join    {check, passcode}                a new number: the person, their passcode, a sign-up session
//	POST /auth/signup/account {account_type, money_kind, name, country?, registration_number?}
//	                                                          the sign-up session's account: a session like any other
//	POST /auth/passkey/challenge {}                           a key sign-in starts, with no number typed
//	POST /auth/passkey/finish {the key's answer, account_id?} the key's answer: a session
//	POST /auth/passkey/register/challenge {kind?}             the key step: one ceremony, the account's approval key and
//	                                                          the person's sign-in key
//	POST /auth/passkey/register {name, passkey|device, passcode?}  the person's sign-in key kept
//	POST /auth/lock          {state: closed|away}             the phone app says it closed or went away
//	POST /auth/unlock/challenge {}                            a challenge for the phone's key (Face ID)
//	POST /auth/unlock        {passcode} | {the key's answer}  the phone app's lock opens
//
// B61.105 — Settings, Security, for a person's session (talyvor-lens B61.23, B61.24, B61.81, B61.104):
//
//	GET  /auth/passkey/keys                                   the person's sign-in keys
//	POST /auth/passkey/keys/remove {key_id, passcode?}        one removed, proved by the passcode or the session's key
//	                                                          sign-in; Lens refuses the last way in
//	POST /auth/passcode/change {old_passcode, passcode}       the passcode changed
//	POST /auth/phone/change-number {check, passcode}          the new number's check (start and finish for it) and the
//	                                                          passcode: the person's number becomes the new one
//
// B61.108 — a forgotten passcode, for a locked or signed-out phone (talyvor-lens B61.107):
//
//	POST /auth/passcode/replace {check, passcode, the key's answer?}  the number's check and a key sign-in of the same
//	                                                          person (the key's answer, or the session's key sign-in):
//	                                                          the new passcode, with no old one
//
// LENS HOLDS EVERY RULE. The codes, the tickets, the passcode's hash and its wrong tries, and the keys live in Lens, on
// the provision secret; the BFF passes the caller's address for Lens's limits and keeps only an opaque check id that
// names Lens's one-use ticket. A ticket alone signs in nobody who has a passcode (Lens refuses it), and the passcode is
// checked by Lens, never here.
//
// UNTIL THE CODE IS RIGHT NOTHING SAYS WHETHER A NUMBER HAS AN ACCOUNT. Starting a check and a wrong code take the same
// path for every number: neither the BFF nor Lens looks the number up before the code is right, so the words, the
// status and the work are the same, and the time with them.
//
// A PERSON'S sub IS THE SAME EVERY WAY IN. A person who joined by phone has the identity Lens gave them
// ("person:<id>") as their sub; a person who moved from Google (B61.25, until B61.29) keeps their Google sub, and Lens
// holds that identity for them. So sign out everywhere, Connect's grants and everything else keyed by sub reach every session of the person
// however they signed in, and identityOf turns a sub back into the identity POST /v1/provision is given.
//
// THE PHONE APP'S LOCK IS THE SERVER'S. A phone session of a person locks when the app says it closed, when it has
// said it went away and 2 minutes pass, when no request has come for 2 minutes, and whenever it is restored from its
// seal; from then every route but unlock (and signing out) answers 423. A copied token opens nothing the lock covers.
// Web sessions do not lock this way.
//
// The phone app sends no Origin, and a browser always sends one on a write: a door request without one answers in its
// body (a Bearer token) and sets no cookie; with one it must be this app's own origin (lens.go) and gets the cookie.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	phoneStartPath               = "/auth/phone/start"
	phoneFinishPath              = "/auth/phone/finish"
	phoneSignInPath              = "/auth/phone/signin"
	phoneJoinPath                = "/auth/phone/join"
	signupAccountPath            = "/auth/signup/account"
	passkeyChallengePath         = "/auth/passkey/challenge"
	passkeyFinishPath            = "/auth/passkey/finish"
	passkeyRegisterChallengePath = "/auth/passkey/register/challenge"
	passkeyRegisterPath          = "/auth/passkey/register"
	lockPath                     = "/auth/lock"
	unlockChallengePath          = "/auth/unlock/challenge"
	unlockPath                   = "/auth/unlock"
	passkeyKeysPath              = "/auth/passkey/keys"
	passkeyKeyRemovePath         = "/auth/passkey/keys/remove"
	passcodeChangePath           = "/auth/passcode/change"
	phoneChangeNumberPath        = "/auth/phone/change-number"
	passcodeReplacePath          = "/auth/passcode/replace"

	// phoneLockAfter is how long a phone session may be away, or quiet, before it locks.
	phoneLockAfter = 2 * time.Minute

	// personIdentityPrefix is how Lens names a person who joined by phone (talyvor-lens phonesignin: "person:"+id).
	personIdentityPrefix = "person:"
)

// phoneDoorPath is every door route that the phone app calls before it holds a session, so sends no Origin.
func phoneDoorPath(path string) bool {
	switch path {
	case phoneStartPath, phoneFinishPath, phoneSignInPath, phoneJoinPath, passkeyChallengePath, passkeyFinishPath,
		passcodeReplacePath:
		return true
	}
	return false
}

// limitDoorIP limits the door by the caller's address, beside Lens's own limits on texts and passcode tries. The
// fallback is Connect's per-address minute (limitAuthorizeIP) until Nicolai sets BFF_PHONE_DOOR_PER_IP_MINUTE.
var limitDoorIP = connectLimit{"phone-door", func() string { return os.Getenv("BFF_PHONE_DOOR_PER_IP_MINUTE") },
	60, time.Minute}

// phoneCheck is a right code, held for its person: Lens's one-use ticket, the number, and whether a person holds it.
type phoneCheck struct {
	phone     string
	ticket    string
	hasPerson bool
	expires   time.Time
}

func (c phoneCheck) expiresAt() time.Time { return c.expires }

// lensPerson is Lens's person (talyvor-lens phonesignin.Person), the fields the BFF reads.
type lensPerson struct {
	ID       string `json:"id"`
	Identity string `json:"identity"`
	Phone    string `json:"phone"`
}

// identityOf is the identity POST /v1/provision is given for sub: a person who joined by phone is their own identity,
// anyone else is (the issuer, their sub).
func (a *app) identityOf(sub string) string {
	if strings.HasPrefix(sub, personIdentityPrefix) {
		return sub
	}
	return provisionIdentity(a.cfg.oidcIssuer, sub)
}

// subOf is identityOf the other way round; false for an identity this BFF did not make.
func (a *app) subOf(identity string) (string, bool) {
	if strings.HasPrefix(identity, personIdentityPrefix) {
		return identity, true
	}
	if sub, ok := strings.CutPrefix(identity, a.cfg.oidcIssuer+"\x00"); ok && sub != "" {
		return sub, true
	}
	return "", false
}

// lockable is a phone session of a person: the lock covers it.
func (s session) lockable() bool { return s.phone && s.personID != "" }

// doorRefusal is a refusal Lens worded for the person, relayed as Lens gave it.
type doorRefusal struct {
	status     int
	body       map[string]any
	retryAfter string
}

func (e doorRefusal) Error() string {
	return fmt.Sprintf("lens refused %d: %v", e.status, e.body["reason"])
}

// doorDown is Lens not answering the door: unreachable (status 0) or a 5xx. It is no refusal, so it spends no check
// (B61.112).
type doorDown struct {
	path   string
	status int
	reason any
	cause  error
}

func (e doorDown) Error() string {
	if e.status == 0 {
		return fmt.Sprintf("lens %s unreachable: %v", e.path, e.cause)
	}
	return fmt.Sprintf("lens %s answered %d", e.path, e.status)
}

// passcodeUnavailable: Lens cannot set or check a passcode just now (LENS_PASSCODE_SECRET unset). The redeem's only
// 503 is that one, in Lens's generic 5xx words; the start's says so by its reason (talyvor-lens B61.113).
func (e doorDown) passcodeUnavailable() bool {
	return e.status == http.StatusServiceUnavailable && (e.reason == "passcode_unavailable" || e.path == "/v1/auth/phone/person")
}

const passcodeUnavailableSentence = "We can't set passcodes just now. Try again in a few minutes."

// lensDoor posts body to one of Lens's sign-in routes on the provision secret and decodes a 2xx into out.
func (a *app) lensDoor(ctx context.Context, path string, body, out any) error {
	if a.cfg.provisionSecret == "" {
		return errors.New("LENS_PROVISION_SECRET is not configured")
	}
	// UPSTREAM-BINDS-ONLY lensDoorBody: none
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.lensBaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(provisionSecretHeader, a.cfg.provisionSecret) // server-side only, never emitted
	resp, err := a.client.Do(req)
	if err != nil {
		return doorDown{path: path, cause: err}
	}
	defer func() { _ = resp.Body.Close() }()
	got, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if out == nil {
			return nil
		}
		return json.Unmarshal(got, out)
	}
	var said map[string]any
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		// B61.93 — a finding route's refusal is worded without a reason, and relayed the same.
		if json.Unmarshal(got, &said) == nil && (said["reason"] != nil || findingWordsPath(path) && said["error"] != nil) {
			return doorRefusal{status: resp.StatusCode, body: said, retryAfter: resp.Header.Get("Retry-After")}
		}
	}
	if resp.StatusCode >= 500 {
		_ = json.Unmarshal(got, &said)
		return doorDown{path: path, status: resp.StatusCode, reason: said["reason"]}
	}
	return fmt.Errorf("lens %s answered %d", path, resp.StatusCode)
}

// writeDoorFailure answers err: Lens's own words for a refusal, and otherwise that the door could not be reached.
func writeDoorFailure(w http.ResponseWriter, what string, err error) {
	var refused doorRefusal
	if errors.As(err, &refused) {
		if refused.retryAfter != "" {
			w.Header().Set("Retry-After", refused.retryAfter)
		}
		out := map[string]any{"error": refused.body["error"], "reason": refused.body["reason"]}
		if at, ok := refused.body["retry_at"]; ok {
			out["retry_at"] = at
		}
		writeJSON(w, refused.status, out)
		return
	}
	var down doorDown
	if errors.As(err, &down) && down.passcodeUnavailable() {
		log.Printf("bff: %s: %s", what, redactSecret(err.Error()))
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": passcodeUnavailableSentence, "reason": "passcode_unavailable"})
		return
	}
	log.Printf("bff: %s: %s", what, redactSecret(err.Error()))
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": "That did not work just now. Try again."})
}

// doorUnavailable answers for the door when it cannot work here: 404 with sign-in off, 503 without the provision
// secret. True if it wrote a response.
func (a *app) doorUnavailable(w http.ResponseWriter, r *http.Request) bool {
	return a.doorUnavailableFor(w, r, http.MethodPost)
}

// doorUnavailableFor is doorUnavailable for a route answering method.
func (a *app) doorUnavailableFor(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method != method {
		methodNotAllowed(w, method)
		return true
	}
	if a.cfg.authMode == authModeDisabled || a.auth == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sign-in is off on this server"})
		return true
	}
	if a.cfg.provisionSecret == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "sign-in is not set up on this server yet"})
		return true
	}
	return false
}

// doorPerIP is perIP for the door, answering in the door's words.
func (a *app) doorPerIP(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		wait, ok := a.oauth.hits.take(limitDoorIP, waitlistClientIP(r), time.Now())
		if !ok {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(wait.Seconds())))))
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many tries. Wait a minute and try again.",
				"reason": "limited"})
			return
		}
		next(w, r)
	}
}

func (a *app) decodeDoor(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return false
	}
	return true
}

// fromPhone is a door request from the phone app: it sends no Origin, and a browser always does on a write.
func fromPhone(r *http.Request) bool { return requestOrigin(r) == "" }

func (a *app) handlePhoneStart(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	var in struct {
		Phone string `json:"phone"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	var out struct {
		ExpiresAt   string `json:"expires_at"`
		Sender      string `json:"sender"`
		SandboxCode string `json:"sandbox_code"`
	}
	if err := a.lensDoor(r.Context(), "/v1/auth/phone/start", map[string]string{"phone": in.Phone,
		"caller_address": waitlistClientIP(r)}, &out); err != nil {
		writeDoorFailure(w, "phone start", err)
		return
	}
	answer := map[string]any{"expires_at": out.ExpiresAt, "sandbox": out.Sender == "sandbox"}
	// Only the Sandbox sender hands its code back, and only it may reach the screen.
	if out.Sender == "sandbox" && out.SandboxCode != "" {
		answer["sandbox_code"] = out.SandboxCode
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, answer)
}

func (a *app) handlePhoneFinish(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	var in struct {
		Phone string `json:"phone"`
		Code  string `json:"code"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	var out struct {
		Ticket    string `json:"ticket"`
		ExpiresAt string `json:"expires_at"`
		HasPerson bool   `json:"has_person"`
	}
	if err := a.lensDoor(r.Context(), "/v1/auth/phone/finish", map[string]string{"phone": in.Phone, "code": in.Code,
		"caller_address": waitlistClientIP(r)}, &out); err != nil {
		writeDoorFailure(w, "phone finish", err)
		return
	}
	expires := parseExpiry(out.ExpiresAt)
	if out.Ticket == "" || expires.IsZero() {
		writeDoorFailure(w, "phone finish", errors.New("lens gave no ticket"))
		return
	}
	id, err := a.auth.storeCheck(phoneCheck{phone: in.Phone, ticket: out.Ticket, hasPerson: out.HasPerson, expires: expires})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"check": id, "has_person": out.HasPerson, "expires_at": out.ExpiresAt})
}

// redeem uses check's ticket at Lens for identity ("" for the number's own person, or a new one) with passcode. A
// refusal that leaves Lens's ticket unused (a wrong passcode, a wait) keeps the check, and so does Lens not answering
// (unreachable, a 5xx, the passcode it cannot set): the person tries again with it (B61.112). Any other end spends it.
func (a *app) redeem(ctx context.Context, checkID string, c phoneCheck, identity, passcode, address string) (lensPerson, bool, error) {
	var out struct {
		Person  lensPerson `json:"person"`
		Created bool       `json:"created"`
	}
	err := a.lensDoor(ctx, "/v1/auth/phone/person", map[string]string{"ticket": c.ticket, "identity": identity,
		"passcode": passcode, "caller_address": address}, &out)
	var (
		refused doorRefusal
		down    doorDown
	)
	switch {
	case errors.As(err, &down):
	case errors.As(err, &refused) && slices.Contains([]any{"wrong_passcode", "passcode_wait", "passcode_needed", "weak_passcode"}, refused.body["reason"]):
	default:
		a.auth.endCheck(checkID, c)
	}
	if err == nil && out.Person.ID == "" {
		err = errors.New("lens gave no person")
	}
	return out.Person, out.Created, err
}

// storeCheck stores a new check and returns its id: sealed with the check when there is a sealer (B61.115).
func (auth *authenticator) storeCheck(c phoneCheck) (string, error) {
	var id string
	var err error
	if auth.checkSealer != nil {
		id, err = auth.checkSealer.seal(c)
	} else {
		id, err = randomToken()
	}
	if err != nil {
		return "", err
	}
	auth.phoneChecks.put(id, c)
	return id, nil
}

// check returns the check stored under id, restoring it from its seal when this process has not seen it.
func (auth *authenticator) check(id string) (phoneCheck, bool) {
	if c, ok := auth.phoneChecks.get(id); ok {
		return c, true
	}
	if auth.checkSealer == nil {
		return phoneCheck{}, false
	}
	c, ok := auth.checkSealer.open(id)
	if !ok {
		return phoneCheck{}, false
	}
	log.Printf("bff: phone check restored from its seal")
	auth.phoneChecks.put(id, c)
	return c, true
}

// endCheck spends id for good: gone from the map, and its seal can no longer restore it.
func (auth *authenticator) endCheck(id string, c phoneCheck) {
	auth.phoneChecks.delete(id)
	if auth.checkSealer != nil {
		auth.checkSealer.end(id, c.expires)
	}
}

func (a *app) takeCheck(w http.ResponseWriter, id string) (phoneCheck, bool) {
	c, ok := a.auth.check(id)
	if !ok || id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "That confirmation has ended. Confirm the number again.",
			"reason": "ticket_ended"})
		return phoneCheck{}, false
	}
	return c, true
}

func (a *app) handlePhoneSignIn(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	var in struct {
		Check     string `json:"check"`
		Passcode  string `json:"passcode"`
		AccountID string `json:"account_id"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	c, ok := a.takeCheck(w, in.Check)
	if !ok {
		return
	}
	if !c.hasPerson {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "That number has no account yet. Join instead.", "reason": "no_person"})
		return
	}
	p, _, err := a.redeem(r.Context(), in.Check, c, "", in.Passcode, waitlistClientIP(r))
	if err != nil {
		writeDoorFailure(w, "phone sign-in", err)
		return
	}
	a.landPerson(w, r, p, in.AccountID, keyTicket{}, nil)
}

func (a *app) handlePhoneJoin(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	var in struct {
		Check    string `json:"check"`
		Passcode string `json:"passcode"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	c, ok := a.takeCheck(w, in.Check)
	if !ok {
		return
	}
	if c.hasPerson {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "That number already has an account. Sign in instead.", "reason": "has_person"})
		return
	}
	if strings.TrimSpace(in.Passcode) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Choose a 6-digit passcode.", "reason": "passcode_needed"})
		return
	}
	p, _, err := a.redeem(r.Context(), in.Check, c, "", in.Passcode, waitlistClientIP(r))
	if err != nil {
		writeDoorFailure(w, "phone join", err)
		return
	}
	a.landPerson(w, r, p, "", keyTicket{}, nil)
}

// landPerson signs p in: on the account asked for, or the one they were last on, or their first; with no account yet,
// a sign-up session (joining) that may only finish sign-up. kt is a key sign-in's ticket, kept in this session alone
// for its next key. extra joins the answer.
func (a *app) landPerson(w http.ResponseWriter, r *http.Request, p lensPerson, accountID string, kt keyTicket, extra map[string]any) {
	sub, ok := a.subOf(p.Identity)
	if !ok {
		log.Printf("bff: phone sign-in for a person whose identity this BFF did not make (person=%s)", p.ID)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "That did not work just now. Try again."})
		return
	}
	now := time.Now()
	s := session{sub: sub, expires: now.Add(a.cfg.sessionTTL), personID: p.ID, phone: fromPhone(r), lastSeen: now, signedInAt: now,
		keyTicket: kt}
	raw, err := a.provisionPost(r.Context(), p.Identity, provisionAsk{mode: "list"}, nil, signupAccount{})
	var list struct {
		Accounts []personAccount `json:"accounts"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &list)
	}
	if err != nil {
		writeDoorFailure(w, "phone sign-in accounts", err)
		return
	}
	if len(list.Accounts) == 0 {
		s.joining = true
	} else {
		pick := list.Accounts[0].ID
		last, _ := a.lastAccounts.Load(p.Identity)
		for _, want := range []any{accountID, last} {
			if id, _ := want.(string); id != "" && slices.ContainsFunc(list.Accounts, func(x personAccount) bool { return x.ID == id }) {
				pick = id
				break
			}
		}
		prov, err := a.provisionAccount(r.Context(), p.Identity, pick)
		if err != nil {
			writeProvisionFailed(w, err)
			return
		}
		s.workspaceID, s.lensToken, s.lensTokenExp, s.cachePoolable = prov.WorkspaceID, prov.Token, parseExpiry(prov.ExpiresAt), prov.CachePoolable
		a.lastAccounts.Store(p.Identity, prov.WorkspaceID)
		s.trackWorkspaceID = a.signInProducts(r.Context(), s.sub, s.email)
	}
	out := map[string]any{"signed_in": true, "signup_unfinished": s.joining, "account_id": s.workspaceID}
	for k, v := range extra {
		out[k] = v
	}
	a.answerSession(w, r, "", s, out)
}

// answerSession stores s, ending replaced (and any session the browser held), and answers out with the phone's token
// or the browser's cookie.
func (a *app) answerSession(w http.ResponseWriter, r *http.Request, replaced string, s session, out map[string]any) {
	if s.phone {
		sid, err := a.auth.storeSession(s)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
			return
		}
		out["token"], out["expires_at"] = sid, s.expires.UTC().Format(time.RFC3339)
	} else if err := a.startSession(w, r, s, int(time.Until(s.expires).Seconds())); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	if replaced != "" {
		a.auth.endSession(replaced)
	}
	log.Printf("bff: door session for sub=%s (person=%s, signup_unfinished=%t)", s.sub, s.personID, s.joining)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

// handleSignupAccount is the sign-up session's account: who it is for and the kind of money, as sign-up asks today.
func (a *app) handleSignupAccount(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	sid, s, ok := a.auth.sessionAndIDFrom(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required — sign in first"})
		return
	}
	if !s.joining {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This sign-up has its account. Open another from Accounts."})
		return
	}
	var in struct {
		AccountType        string `json:"account_type"`
		MoneyKind          string `json:"money_kind"`
		Name               string `json:"name"`
		Country            string `json:"country"`
		RegistrationNumber string `json:"registration_number"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	signup, err := parseSignupAccount(in.AccountType, in.MoneyKind, in.Name, in.Country, in.RegistrationNumber)
	if err == nil && signup == (signupAccount{}) {
		err = errSignupAccount
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	identity := a.identityOf(s.sub)
	prov, err := a.provisionAs(r.Context(), identity, provisionAsk{}, nil, signup)
	if err != nil {
		writeProvisionFailed(w, err)
		return
	}
	next := s
	next.joining = false
	next.workspaceID, next.lensToken, next.lensTokenExp = prov.WorkspaceID, prov.Token, parseExpiry(prov.ExpiresAt)
	next.cachePoolable, next.needsPoolingChoice = prov.CachePoolable, prov.Created
	next.lastSeen = time.Now()
	a.lastAccounts.Store(identity, prov.WorkspaceID)
	a.answerSession(w, r, sid, next, map[string]any{"account_id": prov.WorkspaceID, "created": prov.Created})
}

// keyAnswer is a key's answer to a challenge (talyvor-lens passkey.Assertion): a passkey's WebAuthn fields, or the
// phone's device key's signature over the challenge.
type keyAnswer struct {
	CredentialID      string `json:"credential_id,omitempty"`
	ClientDataJSON    string `json:"client_data_json,omitempty"`
	AuthenticatorData string `json:"authenticator_data,omitempty"`
	Signature         string `json:"signature,omitempty"`
	DeviceID          string `json:"device_id,omitempty"`
	Challenge         string `json:"challenge,omitempty"`
}

type keySignedIn struct {
	Person        lensPerson `json:"person"`
	Ticket        string     `json:"ticket"`
	ExpiresAt     string     `json:"expires_at"`
	PhoneCheckDue bool       `json:"phone_check_due"`
}

// keyChallenge asks Lens for a sign-in challenge: bound to this app's origin for a browser, to none for the phone's
// key, and to personID when the session's person is known.
func (a *app) keyChallenge(w http.ResponseWriter, r *http.Request, personID string) {
	origin := ""
	if !fromPhone(r) {
		origin = a.cfg.publicBaseURL
	}
	var out map[string]any
	if err := a.lensDoor(r.Context(), "/v1/auth/passkey/challenge", map[string]string{"origin": origin, "person_id": personID}, &out); err != nil {
		writeDoorFailure(w, "key challenge", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

func (a *app) handleKeySignInChallenge(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	a.keyChallenge(w, r, "")
}

func (a *app) handleKeySignInFinish(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	var in struct {
		keyAnswer
		AccountID string `json:"account_id"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	var out keySignedIn
	if err := a.lensDoor(r.Context(), "/v1/auth/passkey/finish", struct {
		keyAnswer
		Address string `json:"caller_address"`
	}{in.keyAnswer, waitlistClientIP(r)}, &out); err != nil {
		writeDoorFailure(w, "key sign-in", err)
		return
	}
	a.landPersonWithKey(w, r, out, in.AccountID)
}

func (a *app) landPersonWithKey(w http.ResponseWriter, r *http.Request, out keySignedIn, accountID string) {
	// The key's ticket proves the next key for 5 minutes (Lens B61.24), so adding one straight after, in the session
	// this sign-in opened, asks for nothing.
	a.landPerson(w, r, out.Person, accountID, keyTicket{ticket: out.Ticket, expires: parseExpiry(out.ExpiresAt)},
		map[string]any{"phone_check_due": out.PhoneCheckDue})
}

// keyTicket is a key sign-in's ticket from Lens, kept server-side in the session that sign-in opened (never sealed).
type keyTicket struct {
	ticket  string
	expires time.Time
}

// personSession is the session of a person (one who has a person record), or a refusal written.
func (a *app) personSession(w http.ResponseWriter, r *http.Request) (string, session, bool) {
	sid, s, ok := a.auth.sessionAndIDFrom(r)
	switch {
	case !ok:
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required — sign in first"})
	case s.personID == "":
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Confirm your phone number first.", "reason": "phone_needed"})
	default:
		return sid, s, true
	}
	return "", session{}, false
}

func (a *app) handlePasskeyRegisterChallenge(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	_, s, ok := a.personSession(w, r)
	if !ok {
		return
	}
	var in struct {
		Kind string `json:"kind"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	var out map[string]any
	// With an account, the one ceremony also makes that account's approval key (Lens checks the person holds it).
	if err := a.lensDoor(r.Context(), "/v1/auth/passkey/register/challenge", map[string]string{"person_id": s.personID,
		"workspace_id": s.workspaceID, "kind": in.Kind}, &out); err != nil {
		writeDoorFailure(w, "key register challenge", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

func (a *app) handlePasskeyRegister(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	sid, s, ok := a.personSession(w, r)
	if !ok {
		return
	}
	var in struct {
		Name     string          `json:"name"`
		Passkey  json.RawMessage `json:"passkey,omitempty"`
		Device   json.RawMessage `json:"device,omitempty"`
		Passcode string          `json:"passcode"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	body := map[string]any{"person_id": s.personID, "name": in.Name, "passcode": in.Passcode, "caller_address": waitlistClientIP(r)}
	if len(in.Passkey) > 0 {
		body["passkey"] = in.Passkey
	}
	if len(in.Device) > 0 {
		body["device"] = in.Device
	}
	if in.Passcode == "" && s.keyTicket.ticket != "" && time.Now().Before(s.keyTicket.expires) {
		body["key_ticket"] = s.keyTicket.ticket
		a.auth.sessions.update(sid, func(cur session) session { cur.keyTicket = keyTicket{}; return cur })
	}
	var out map[string]any
	if err := a.lensDoor(r.Context(), "/v1/auth/passkey/register", body, &out); err != nil {
		writeDoorFailure(w, "key register", err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// handlePasskeyKeys lists the person's sign-in keys, as Lens keeps them.
func (a *app) handlePasskeyKeys(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailableFor(w, r, http.MethodGet) {
		return
	}
	_, s, ok := a.personSession(w, r)
	if !ok {
		return
	}
	var out map[string]any
	if err := a.lensDoor(r.Context(), "/v1/auth/passkey/keys", map[string]string{"person_id": s.personID}, &out); err != nil {
		writeDoorFailure(w, "key list", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

// handlePasskeyKeyRemove removes one of the person's keys, proved as a new key is: the passcode, or the key sign-in
// that opened this session. Lens refuses the last way in.
func (a *app) handlePasskeyKeyRemove(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	sid, s, ok := a.personSession(w, r)
	if !ok {
		return
	}
	var in struct {
		KeyID    string `json:"key_id"`
		Passcode string `json:"passcode"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	body := map[string]any{"person_id": s.personID, "key_id": in.KeyID, "passcode": in.Passcode, "caller_address": waitlistClientIP(r)}
	if in.Passcode == "" && s.keyTicket.ticket != "" && time.Now().Before(s.keyTicket.expires) {
		body["key_ticket"] = s.keyTicket.ticket
		a.auth.sessions.update(sid, func(cur session) session { cur.keyTicket = keyTicket{}; return cur })
	}
	if err := a.lensDoor(r.Context(), "/v1/auth/passkey/keys/remove", body, nil); err != nil {
		writeDoorFailure(w, "key remove", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}

// handlePasscodeChange changes the person's passcode: the old one, checked by Lens with its wrong tries, and the new.
func (a *app) handlePasscodeChange(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	_, s, ok := a.personSession(w, r)
	if !ok {
		return
	}
	var in struct {
		OldPasscode string `json:"old_passcode"`
		Passcode    string `json:"passcode"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	if err := a.lensDoor(r.Context(), "/v1/auth/passcode/change", map[string]string{"person_id": s.personID,
		"old_passcode": in.OldPasscode, "passcode": in.Passcode, "caller_address": waitlistClientIP(r)}, nil); err != nil {
		writeDoorFailure(w, "passcode change", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"changed": true})
}

// handlePhoneChangeNumber moves the person onto a new number: its check, from the door's start and finish, and their
// passcode. Every refusal leaves Lens's ticket unused, so the check is kept but for an ended ticket; the change spends it.
func (a *app) handlePhoneChangeNumber(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	_, s, ok := a.personSession(w, r)
	if !ok {
		return
	}
	var in struct {
		Check    string `json:"check"`
		Passcode string `json:"passcode"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	c, ok := a.takeCheck(w, in.Check)
	if !ok {
		return
	}
	var out struct {
		MoveID string     `json:"move_id"`
		Person lensPerson `json:"person"`
	}
	err := a.lensDoor(r.Context(), "/v1/auth/phone/change-number", map[string]string{"person_id": s.personID,
		"ticket": c.ticket, "passcode": in.Passcode, "caller_address": waitlistClientIP(r)}, &out)
	var refused doorRefusal
	if err == nil || errors.As(err, &refused) && refused.body["reason"] == "ticket_ended" {
		a.auth.endCheck(in.Check, c)
	}
	if err != nil {
		writeDoorFailure(w, "number change", err)
		return
	}
	log.Printf("bff: person changed their number (person=%s move=%s)", s.personID, out.MoveID)
	writeJSON(w, http.StatusOK, map[string]any{"changed": true, "phone": out.Person.Phone})
}

// handlePasscodeReplace sets a forgotten passcode again, for a locked or signed-out phone: the number's check, from the
// door's start and finish, and a key sign-in of the same person: the key's answer sent with it (Face ID on the lock's
// challenge or the door's), or else, on a session not locked, the key sign-in that opened it. Lens holds the rules and refuses either
// alone in words; a refusal leaves Lens's tickets unused, so the check is kept but for an ended ticket, and the new
// passcode spends it. A locked session stays locked: the new passcode then opens it.
func (a *app) handlePasscodeReplace(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	var in struct {
		keyAnswer
		Check    string `json:"check"`
		Passcode string `json:"passcode"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	c, ok := a.takeCheck(w, in.Check)
	if !ok {
		return
	}
	address := waitlistClientIP(r)
	sid, s, signedIn := a.auth.sessionAndIDFrom(r)
	key := ""
	switch {
	case in.Signature != "":
		var out keySignedIn
		if err := a.lensDoor(r.Context(), "/v1/auth/passkey/finish", struct {
			keyAnswer
			Address string `json:"caller_address"`
		}{in.keyAnswer, address}, &out); err != nil {
			writeDoorFailure(w, "passcode replace key", err)
			return
		}
		if signedIn && s.personID != "" && out.Person.ID != s.personID {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "That key is not yours.", "reason": "no_key"})
			return
		}
		key = out.Ticket
	case signedIn && !s.locked && s.keyTicket.ticket != "" && time.Now().Before(s.keyTicket.expires):
		// Not at the lock: the phone gets its own texts, so whoever holds a locked phone must answer Face ID.
		key = s.keyTicket.ticket
		a.auth.sessions.update(sid, func(cur session) session { cur.keyTicket = keyTicket{}; return cur })
	}
	var out struct {
		Person lensPerson `json:"person"`
	}
	err := a.lensDoor(r.Context(), "/v1/auth/passcode/replace", map[string]string{"ticket": c.ticket, "key_ticket": key,
		"passcode": in.Passcode, "caller_address": address}, &out)
	var refused doorRefusal
	if err == nil || errors.As(err, &refused) && refused.body["reason"] == "ticket_ended" {
		a.auth.endCheck(in.Check, c)
	}
	if err != nil {
		writeDoorFailure(w, "passcode replace", err)
		return
	}
	log.Printf("bff: person set a forgotten passcode again (person=%s)", out.Person.ID)
	w.WriteHeader(http.StatusNoContent)
}

// lockableSession is the phone app's session of a person, or a refusal written: 401 with no session, 409 for any
// other session.
func (a *app) lockableSession(w http.ResponseWriter, r *http.Request) (string, session, bool) {
	sid, s, ok := a.auth.sessionAndIDFrom(r)
	switch {
	case !ok:
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required — sign in first"})
	case !s.lockable():
		writeJSON(w, http.StatusConflict, map[string]string{"error": "only the phone app's session of a person locks"})
	default:
		return sid, s, true
	}
	return "", session{}, false
}

// handleLock is the phone app saying it closed (the lock shuts now) or went away (it shuts after phoneLockAfter).
func (a *app) handleLock(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	sid, _, ok := a.lockableSession(w, r)
	if !ok {
		return
	}
	var in struct {
		State string `json:"state"`
	}
	if !a.decodeDoor(w, r, &in) || (in.State != "closed" && in.State != "away") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `send {"state": "closed"} or {"state": "away"}`})
		return
	}
	now := time.Now()
	a.auth.sessions.update(sid, func(cur session) session {
		if in.State == "closed" {
			cur.locked = true
		} else if cur.awayAt.IsZero() {
			cur.awayAt = now
		}
		return cur
	})
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) handleUnlockChallenge(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	_, s, ok := a.lockableSession(w, r)
	if !ok {
		return
	}
	a.keyChallenge(w, r, s.personID)
}

// handleUnlock opens the phone app's lock with the person's passcode, checked by Lens, or the phone key's signature
// over a challenge Lens gave for this person.
func (a *app) handleUnlock(w http.ResponseWriter, r *http.Request) {
	if a.doorUnavailable(w, r) {
		return
	}
	sid, s, ok := a.lockableSession(w, r)
	if !ok {
		return
	}
	var in struct {
		keyAnswer
		Passcode string `json:"passcode"`
	}
	if !a.decodeDoor(w, r, &in) {
		return
	}
	address := waitlistClientIP(r)
	if in.Signature == "" && in.Passcode == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Enter your passcode.", "reason": "passcode_needed"})
		return
	}
	if in.Signature == "" {
		if err := a.lensDoor(r.Context(), "/v1/auth/passcode/check", map[string]string{"person_id": s.personID,
			"passcode": in.Passcode, "caller_address": address}, nil); err != nil {
			writeDoorFailure(w, "unlock", err)
			return
		}
	} else {
		var out keySignedIn
		if err := a.lensDoor(r.Context(), "/v1/auth/passkey/finish", struct {
			keyAnswer
			Address string `json:"caller_address"`
		}{in.keyAnswer, address}, &out); err != nil {
			writeDoorFailure(w, "unlock", err)
			return
		}
		if out.Person.ID != s.personID {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "That key is not yours.", "reason": "no_key"})
			return
		}
	}
	now := time.Now()
	if _, ok := a.auth.sessions.update(sid, func(cur session) session {
		cur.locked, cur.awayAt, cur.lastSeen = false, time.Time{}, now
		return cur
	}); !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required — sign in first"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// lockedOrJoining runs before the mux: a sign-up session reaches only sign-up's steps (403 otherwise), and a locked
// phone session only unlock, a forgotten passcode set again and signing out (423 otherwise). A phone session that has been away or quiet for
// phoneLockAfter locks here, on its next request.
func (a *app) lockedOrJoining(w http.ResponseWriter, r *http.Request) bool {
	if a.cfg.authMode == authModeDisabled || a.auth == nil {
		return false
	}
	sid, s, ok := a.auth.sessionAndIDFrom(r)
	if !ok {
		return false
	}
	if s.joining {
		switch r.URL.Path {
		case signupAccountPath, "/auth/me", "/auth/logout", lockPath:
		default:
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Finish signing up first.", "reason": "signup_unfinished"})
			return true
		}
	}
	if !s.lockable() {
		return false
	}
	now := time.Now()
	cur, _ := a.auth.sessions.update(sid, func(v session) session {
		if !v.locked && (now.Sub(v.lastSeen) >= phoneLockAfter || !v.awayAt.IsZero() && now.Sub(v.awayAt) >= phoneLockAfter) {
			v.locked = true
		}
		if !v.locked {
			v.lastSeen, v.awayAt = now, time.Time{}
		}
		return v
	})
	switch r.URL.Path {
	case unlockPath, unlockChallengePath, passcodeReplacePath, "/auth/logout", lockPath:
		return false
	}
	if cur.locked {
		writeJSON(w, http.StatusLocked, map[string]string{"error": "Unlock the app with your passcode or Face ID.", "reason": "locked"})
		return true
	}
	return false
}
