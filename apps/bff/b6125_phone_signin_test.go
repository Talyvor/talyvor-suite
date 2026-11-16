package main

// b6125_phone_signin_test.go — B61.25: join and sign in by phone, passcode and passkey, the phone app's lock and the
// move from Google, through the real BFF over TLS against Lens's test doubles: doorLens answers Lens's sign-in routes
// (talyvor-lens B61.22, B61.23, B61.24) as cmd/lens answers them, and hands everything else to the stranger suite's
// Lens, which answers provision's modes and reads each account on its own token.

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// doorPerson is one person in doorLens.
type doorPerson struct {
	id, identity, passcode string
	device                 string // the device id of the phone's key, "" with none
}

// doorLens stands in for Lens's sign-in routes. Codes are 6 digits handed back as the Sandbox sender's; a ticket is
// used once; a passcode refused leaves the ticket unused, as RedeemWithPasscode does.
type doorLens struct {
	srv *httptest.Server

	mu         sync.Mutex
	n          int
	codes      map[string]string // phone → the code last sent
	tickets    map[string]string // ticket → phone
	people     map[string]*doorPerson
	challenges map[string]string // challenge → the person it names, "" for none
	origins    map[string]string // challenge → the origin it was asked from
	calls      []string
	bodies     map[string]map[string]any // path → the last body
	down       map[string]map[string]any // path → the 503 body Lens answers there instead (B61.112)
}

func newDoorLens(t *testing.T, rest *strangerLens) *doorLens {
	t.Helper()
	d := &doorLens{codes: map[string]string{}, tickets: map[string]string{}, people: map[string]*doorPerson{},
		challenges: map[string]string{}, origins: map[string]string{}, bodies: map[string]map[string]any{},
		down: map[string]map[string]any{}}
	target, _ := url.Parse(rest.srv.URL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	d.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/auth/") {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Header.Get(provisionSecretHeader) != testProvisionSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		str := func(k string) string { s, _ := in[k].(string); return s }
		w.Header().Set("Content-Type", "application/json")
		refuse := func(status int, reason string) {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "refused: " + reason, "reason": reason})
		}
		d.mu.Lock()
		defer d.mu.Unlock()
		d.calls = append(d.calls, r.URL.Path)
		d.bodies[r.URL.Path] = in
		d.n++
		if said, ok := d.down[r.URL.Path]; ok {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(said)
			return
		}
		switch r.URL.Path {
		case "/v1/auth/phone/start":
			if str("caller_address") == "" {
				refuse(http.StatusBadRequest, "address")
				return
			}
			code := strconv.Itoa(100000 + d.n*7919%900000)
			d.codes[str("phone")] = code
			_ = json.NewEncoder(w).Encode(map[string]string{"expires_at": "2099-01-01T00:10:00Z", "sender": "sandbox", "sandbox_code": code})
		case "/v1/auth/phone/finish":
			code, ok := d.codes[str("phone")]
			switch {
			case !ok:
				refuse(http.StatusBadRequest, "code_ended")
				return
			case code != str("code"):
				refuse(http.StatusBadRequest, "wrong_code")
				return
			}
			delete(d.codes, str("phone"))
			ticket := "tkt-" + strconv.Itoa(d.n)
			d.tickets[ticket] = str("phone")
			_, has := d.people[str("phone")]
			_ = json.NewEncoder(w).Encode(map[string]any{"ticket": ticket, "expires_at": "2099-01-01T00:05:00Z", "has_person": has, "sandbox": true})
		case "/v1/auth/phone/person":
			phone, ok := d.tickets[str("ticket")]
			if !ok {
				refuse(http.StatusBadRequest, "ticket_ended")
				return
			}
			p, known := d.people[phone]
			switch {
			case known && str("identity") != "" && str("identity") != p.identity:
				delete(d.tickets, str("ticket"))
				refuse(http.StatusConflict, "held")
				return
			case known && str("passcode") == "":
				refuse(http.StatusBadRequest, "passcode_needed")
				return
			case known && str("passcode") != p.passcode:
				refuse(http.StatusBadRequest, "wrong_passcode")
				return
			}
			delete(d.tickets, str("ticket"))
			created := !known
			if created {
				id := "per_" + strconv.Itoa(d.n)
				identity := str("identity")
				if identity == "" {
					identity = "person:" + id
				}
				p = &doorPerson{id: id, identity: identity, passcode: str("passcode")}
				d.people[phone] = p
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"person": map[string]any{"id": p.id, "phone": phone, "identity": p.identity}, "created": created})
		case "/v1/auth/passcode/check":
			for _, p := range d.people {
				if p.id == str("person_id") {
					if p.passcode == str("passcode") {
						_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
					} else {
						refuse(http.StatusBadRequest, "wrong_passcode")
					}
					return
				}
			}
			refuse(http.StatusNotFound, "no_passcode")
		case "/v1/auth/passkey/challenge":
			c := "chl-" + strconv.Itoa(d.n)
			d.challenges[c], d.origins[c] = str("person_id"), str("origin")
			_ = json.NewEncoder(w).Encode(map[string]any{"challenge": c, "expires_at": "2099-01-01T00:05:00Z", "user_verification": "required"})
		case "/v1/auth/passkey/finish":
			named, ok := d.challenges[str("challenge")]
			delete(d.challenges, str("challenge"))
			if !ok {
				refuse(http.StatusBadRequest, "challenge_ended")
				return
			}
			for phone, p := range d.people {
				if p.device != "" && p.device == str("device_id") && str("signature") == "signed:"+str("challenge") && (named == "" || named == p.id) {
					_ = json.NewEncoder(w).Encode(map[string]any{"person": map[string]any{"id": p.id, "phone": phone, "identity": p.identity},
						"key_id": "pky_1", "ticket": "ktk-" + strconv.Itoa(d.n), "expires_at": "2099-01-01T00:05:00Z"})
					return
				}
			}
			refuse(http.StatusUnauthorized, "no_key")
		case "/v1/auth/passkey/register/challenge":
			_ = json.NewEncoder(w).Encode(map[string]any{"challenge": "reg-" + strconv.Itoa(d.n), "user_handle": str("person_id")})
		case "/v1/auth/passkey/register":
			for _, p := range d.people {
				if p.id == str("person_id") {
					if str("passcode") != p.passcode && str("key_ticket") == "" {
						refuse(http.StatusForbidden, "proof_needed")
						return
					}
					dev, _ := in["device"].(map[string]any)
					p.device, _ = dev["public_key"].(string)
					w.WriteHeader(http.StatusCreated)
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "pky_" + strconv.Itoa(d.n), "kind": "device"})
					return
				}
			}
			refuse(http.StatusNotFound, "no_person")
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(d.srv.Close)
	return d
}

func (d *doorLens) body(path string) map[string]any {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.bodies[path]
}

// doorSuite is the stranger suite with doorLens in front of its Lens.
type doorSuite struct {
	*strangerSuite
	door *doorLens
}

func startDoorSuite(t *testing.T, mod func(*config)) *doorSuite {
	t.Helper()
	s := startStrangerSuiteWith(t, []string{"*"}, mod)
	d := newDoorLens(t, s.lens)
	s.app.cfg.lensBaseURL = d.srv.URL // the door in front of the stranger suite's Lens, which it hands the rest
	return &doorSuite{strangerSuite: s, door: d}
}

// post sends a JSON write as the web app does (Origin and Sec-Fetch-Site of this app) through br, or, with br nil, as
// the phone app does: no Origin, and the Bearer token when one is given.
func (s *doorSuite) post(br *http.Client, bearer, path string, body any) (int, map[string]any, http.Header) {
	s.t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, s.ts.URL+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	client := br
	if br == nil {
		client = s.ts.Client()
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
	} else {
		req.Header.Set("Origin", s.ts.URL)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
	}
	resp, err := client.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer resp.Body.Close()
	got, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(got, &out)
	return resp.StatusCode, out, resp.Header
}

// get reads path as br (a browser) or, with br nil, as the phone with bearer.
func (s *doorSuite) get(br *http.Client, bearer, path string) (int, map[string]any) {
	s.t.Helper()
	req, _ := http.NewRequest(http.MethodGet, s.ts.URL+path, nil)
	client := br
	if br == nil {
		client = s.ts.Client()
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := client.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer resp.Body.Close()
	got, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(got, &out)
	return resp.StatusCode, out
}

// confirm runs the texted code for phone through br (nil: the phone) and answers the check and whether a person holds
// the number.
func (s *doorSuite) confirm(br *http.Client, phone string) (string, bool) {
	s.t.Helper()
	st, out, _ := s.post(br, "", "/auth/phone/start", map[string]string{"phone": phone})
	code, _ := out["sandbox_code"].(string)
	if st != http.StatusOK || code == "" || out["sandbox"] != true {
		s.t.Fatalf("phone start: %d %v", st, out)
	}
	st, out, _ = s.post(br, "", "/auth/phone/finish", map[string]string{"phone": phone, "code": code})
	check, _ := out["check"].(string)
	if st != http.StatusOK || check == "" {
		s.t.Fatalf("phone finish: %d %v", st, out)
	}
	has, _ := out["has_person"].(bool)
	return check, has
}

// join makes a new person for phone with passcode and their personal account, through br; it answers their account.
func (s *doorSuite) join(br *http.Client, phone, passcode string) string {
	s.t.Helper()
	check, has := s.confirm(br, phone)
	if has {
		s.t.Fatalf("a new number reads as held")
	}
	if st, out, _ := s.post(br, "", "/auth/phone/join", map[string]string{"check": check, "passcode": passcode}); st != http.StatusOK || out["signup_unfinished"] != true {
		s.t.Fatalf("join: %d %v", st, out)
	}
	st, out, _ := s.post(br, "", "/auth/signup/account", map[string]string{"account_type": "personal", "money_kind": "fiat", "name": "Maya Lind"})
	if st != http.StatusOK {
		s.t.Fatalf("sign-up account: %d %v", st, out)
	}
	ws, _ := out["account_id"].(string)
	return ws
}

func TestB6125_NewNumberJoinsEndToEnd(t *testing.T) {
	s := startDoorSuite(t, nil)
	br := s.browser()
	check, has := s.confirm(br, "+447700900001")
	if has {
		t.Fatal("a new number reads as held")
	}
	st, out, _ := s.post(br, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"})
	if st != http.StatusOK || out["signup_unfinished"] != true {
		t.Fatalf("join: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/phone/person"); b["passcode"] != "418263" || b["caller_address"] == "" || b["identity"] != "" {
		t.Fatalf("join's redeem at Lens: %v", b)
	}
	// The sign-up session does sign-up's steps and nothing else.
	if st, out := s.get(br, "", "/api/accounts"); st != http.StatusForbidden || out["reason"] != "signup_unfinished" {
		t.Fatalf("a sign-up session read its accounts: %d %v", st, out)
	}
	st, out, _ = s.post(br, "", "/auth/signup/account", map[string]string{"account_type": "personal", "money_kind": "fiat", "name": "Maya Lind"})
	ws, _ := out["account_id"].(string)
	if st != http.StatusOK || ws == "" {
		t.Fatalf("sign-up account: %d %v", st, out)
	}
	// The account is the person's identity's, read from Lens on its own token.
	if got := s.accountTypeOf(br); got != "personal "+ws {
		t.Fatalf("the account the session reaches: %q, want personal %s", got, ws)
	}
	if ws != deriveWorkspaceIDLikeLens("person:per_3") {
		t.Fatalf("the account %s is not the first account of the person's identity", ws)
	}
	// The key step: one ceremony makes the account's approval key and the person's sign-in key.
	if st, out, _ := s.post(br, "", "/auth/passkey/register/challenge", map[string]string{"kind": "device"}); st != http.StatusOK || out["challenge"] == nil {
		t.Fatalf("key challenge: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/passkey/register/challenge"); b["workspace_id"] != ws || b["person_id"] != "per_3" {
		t.Fatalf("the key step's challenge at Lens: %v", b)
	}
	if st, out, _ := s.post(br, "", "/auth/passkey/register", map[string]any{"name": "iPhone", "device": map[string]string{"public_key": "dev-a"}}); st != http.StatusForbidden || out["reason"] != "proof_needed" {
		t.Fatalf("a key added with no proof: %d %v", st, out)
	}
	if st, out, _ := s.post(br, "", "/auth/passkey/register", map[string]any{"name": "iPhone", "device": map[string]string{"public_key": "dev-a"}, "passcode": "418263"}); st != http.StatusCreated {
		t.Fatalf("the key with the passcode: %d %v", st, out)
	}
}

func TestB6125_NumberCodeAndPasscodeSignIn(t *testing.T) {
	s := startDoorSuite(t, nil)
	ws := s.join(s.browser(), "+447700900002", "418263")

	br := s.browser()
	check, has := s.confirm(br, "+447700900002")
	if !has {
		t.Fatal("a held number reads as new after the right code")
	}
	for _, try := range []struct {
		passcode, reason string
	}{{"", "passcode_needed"}, {"999111", "wrong_passcode"}} {
		if st, out, _ := s.post(br, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": try.passcode}); st != http.StatusBadRequest || out["reason"] != try.reason {
			t.Fatalf("passcode %q: %d %v, want 400 %s", try.passcode, st, out, try.reason)
		}
	}
	if st, _ := s.get(br, "", "/api/accounts"); st != http.StatusUnauthorized {
		t.Fatalf("a wrong passcode opened a session: %d", st)
	}
	// The check outlives a wrong passcode, as Lens's ticket does, and the right one signs in on the person's account.
	if st, out, _ := s.post(br, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK || out["account_id"] != ws {
		t.Fatalf("the right passcode: %d %v", st, out)
	}
	if got := s.accountTypeOf(br); got != "personal "+ws {
		t.Fatalf("signed in to %q, want personal %s", got, ws)
	}
	// A replayed check signs nobody in.
	if st, out, _ := s.post(s.browser(), "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusBadRequest || out["reason"] != "ticket_ended" {
		t.Fatalf("a replayed check: %d %v", st, out)
	}
	// An old code is refused in Lens's words.
	st, out, _ := s.post(br, "", "/auth/phone/start", map[string]string{"phone": "+447700900002"})
	old, _ := out["sandbox_code"].(string)
	s.post(br, "", "/auth/phone/start", map[string]string{"phone": "+447700900002"})
	if st, out, _ = s.post(br, "", "/auth/phone/finish", map[string]string{"phone": "+447700900002", "code": old}); st != http.StatusBadRequest || out["reason"] != "wrong_code" {
		t.Fatalf("an old code: %d %v", st, out)
	}
}

func TestB6125_KnownAndUnknownNumberAnswerTheSameUntilTheCodeIsRight(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900003", "418263")
	answer := func(phone string) string {
		st, out, _ := s.post(nil, "", "/auth/phone/start", map[string]string{"phone": phone})
		delete(out, "sandbox_code")
		st2, out2, _ := s.post(nil, "", "/auth/phone/finish", map[string]string{"phone": phone, "code": "000000"})
		a, _ := json.Marshal([]any{st, out, st2, out2})
		return string(a)
	}
	if known, unknown := answer("+447700900003"), answer("+447700900004"); known != unknown {
		t.Fatalf("a held number and a new one answer apart:\n%s\n%s", known, unknown)
	}
}

func TestB6125_PasskeySignsInOnTheAccountLastUsed(t *testing.T) {
	s := startDoorSuite(t, nil)
	br := s.browser()
	first := s.join(br, "+447700900005", "418263")
	s.door.mu.Lock()
	s.door.people["+447700900005"].device = "dev-5"
	s.door.mu.Unlock()
	st, out, _ := s.post(br, "", "/api/accounts", map[string]string{"type": "business", "kind": "hybrid", "name": "Northwind"})
	second, _ := out["account_id"].(string)
	if st != http.StatusOK || second == "" || second == first {
		t.Fatalf("open another: %d %v", st, out)
	}

	other := s.browser()
	st, out, _ = s.post(other, "", "/auth/passkey/challenge", map[string]string{})
	challenge, _ := out["challenge"].(string)
	if st != http.StatusOK || challenge == "" {
		t.Fatalf("key challenge: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/passkey/challenge"); b["origin"] != s.ts.URL || b["person_id"] != "" {
		t.Fatalf("a browser's challenge at Lens: %v", b)
	}
	// A replayed answer, and another key, sign nobody in.
	answer := map[string]string{"device_id": "dev-5", "challenge": challenge, "signature": "signed:" + challenge}
	if st, out, _ = s.post(other, "", "/auth/passkey/finish", answer); st != http.StatusOK || out["account_id"] != second {
		t.Fatalf("key sign-in: %d %v, want the account last used %s", st, out, second)
	}
	if st, out, _ = s.post(s.browser(), "", "/auth/passkey/finish", answer); st != http.StatusBadRequest || out["reason"] != "challenge_ended" {
		t.Fatalf("a replayed key answer: %d %v", st, out)
	}
	if got := s.accountTypeOf(other); got != "business "+second {
		t.Fatalf("signed in to %q, want business %s", got, second)
	}
	// The key sign-in's ticket proves the next key in the session it opened, and in no other session of the person.
	key := map[string]any{"name": "Laptop", "device": map[string]string{"public_key": "dev-5b"}}
	if st, out, _ := s.post(br, "", "/auth/passkey/register", key); st != http.StatusForbidden || out["reason"] != "proof_needed" {
		t.Fatalf("another session of the person added a key on the sign-in's ticket: %d %v", st, out)
	}
	if st, out, _ := s.post(other, "", "/auth/passkey/register", key); st != http.StatusCreated {
		t.Fatalf("a key straight after a key sign-in: %d %v", st, out)
	}
}

func TestB6125_LockedPhoneSessionGets423UntilUnlocked(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900006", "418263")
	s.door.mu.Lock()
	s.door.people["+447700900006"].device = "dev-6"
	s.door.mu.Unlock()

	check, _ := s.confirm(nil, "+447700900006")
	st, out, hdr := s.post(nil, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"})
	token, _ := out["token"].(string)
	if st != http.StatusOK || token == "" || hdr.Get("Set-Cookie") != "" {
		t.Fatalf("the phone's sign-in: %d %v (cookie %q)", st, out, hdr.Get("Set-Cookie"))
	}
	if st, _ := s.get(nil, token, "/api/agents"); st != http.StatusOK {
		t.Fatalf("an open phone session read its agents: %d", st)
	}
	if st, _, _ := s.post(nil, token, "/auth/lock", map[string]string{"state": "closed"}); st != http.StatusNoContent {
		t.Fatalf("lock: %d", st)
	}
	if st, out := s.get(nil, token, "/api/agents"); st != http.StatusLocked || out["reason"] != "locked" {
		t.Fatalf("a locked phone session read its agents: %d %v", st, out)
	}
	if st, out, _ := s.post(nil, token, "/auth/unlock", map[string]string{"passcode": "999111"}); st != http.StatusBadRequest || out["reason"] != "wrong_passcode" {
		t.Fatalf("a wrong passcode at the lock: %d %v", st, out)
	}
	if st, _, _ := s.post(nil, token, "/auth/unlock", map[string]string{"passcode": "418263"}); st != http.StatusNoContent {
		t.Fatalf("unlock with the passcode: %d", st)
	}
	if st, _ := s.get(nil, token, "/api/agents"); st != http.StatusOK {
		t.Fatalf("an unlocked phone session: %d", st)
	}

	// Face ID: the phone key signs a challenge Lens gave for this person.
	s.post(nil, token, "/auth/lock", map[string]string{"state": "closed"})
	st, out, _ = s.post(nil, token, "/auth/unlock/challenge", map[string]string{})
	challenge, _ := out["challenge"].(string)
	if b := s.door.body("/v1/auth/passkey/challenge"); st != http.StatusOK || b["person_id"] != "per_3" || b["origin"] != "" {
		t.Fatalf("the unlock challenge: %d %v (at Lens %v)", st, out, b)
	}
	if st, _, _ := s.post(nil, token, "/auth/unlock", map[string]string{"device_id": "dev-6", "challenge": challenge, "signature": "signed:" + challenge}); st != http.StatusNoContent {
		t.Fatalf("unlock with the key: %d", st)
	}
	if st, _ := s.get(nil, token, "/api/agents"); st != http.StatusOK {
		t.Fatalf("unlocked by the key: %d", st)
	}
}

func TestB6125_GoogleMovesOnceAndKeepsItsAccounts(t *testing.T) {
	s := startDoorSuite(t, nil)
	br := s.signUp("google-sub-7", "maya@example.org")
	if _, out := s.get(br, "", "/auth/me"); out["phone_needed"] != true || out["google_signin"] != true {
		t.Fatalf("a Google sign-in with no number: %v", out)
	}
	// The account each session is on, as Lens reads its token (the stranger suite's default answer names it).
	on := func(br *http.Client) string {
		_, out := s.get(br, "", "/api/earnings")
		ws, _ := out["belongs_to"].(string)
		if ws == "" {
			t.Fatalf("no account read: %v", out)
		}
		return ws
	}
	before := on(br)
	check, _ := s.confirm(br, "+447700900007")
	if st, out, _ := s.post(br, "", "/auth/google/move", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK || out["moved"] != true {
		t.Fatalf("the move: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/phone/person"); b["identity"] != provisionIdentity(s.idp.srv.URL, "google-sub-7") {
		t.Fatalf("the person was not given the Google identity: %v", b)
	}
	if _, out := s.get(br, "", "/auth/me"); out["phone_needed"] != false {
		t.Fatalf("after the move: %v", out)
	}
	if after := on(br); after != before {
		t.Fatalf("the move changed the account: %q → %q", before, after)
	}
	// From then the number, its code and the passcode open the same account, with no Google.
	other := s.browser()
	check, _ = s.confirm(other, "+447700900007")
	if st, out, _ := s.post(other, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK {
		t.Fatalf("the new way in: %d %v", st, out)
	}
	if got := on(other); got != before {
		t.Fatalf("the new way in reached %q, Google's was %q", got, before)
	}
}

func TestB6125_GoogleOffRemovesItsRoutes(t *testing.T) {
	s := startDoorSuite(t, func(c *config) { c.googleSignInOff = true })
	for _, rt := range []struct{ method, path string }{{http.MethodGet, "/auth/login"}, {http.MethodGet, "/auth/callback"},
		{http.MethodPost, "/auth/mobile/session"}, {http.MethodPost, "/auth/google/move"}} {
		req, _ := http.NewRequest(rt.method, s.ts.URL+rt.path, strings.NewReader(`{}`))
		req.Header.Set("Origin", s.ts.URL)
		resp, err := s.ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s with Google off: %d, want 404", rt.method, rt.path, resp.StatusCode)
		}
	}
	if _, out := s.get(s.browser(), "", "/auth/me"); out["google_signin"] != false {
		t.Fatalf("/auth/me with Google off: %v", out)
	}
}

func TestB6125_DoorRefusesAnotherSite(t *testing.T) {
	s := startDoorSuite(t, nil)
	for _, path := range []string{"/auth/phone/start", "/auth/phone/finish", "/auth/phone/signin", "/auth/phone/join",
		"/auth/signup/account", "/auth/passkey/challenge", "/auth/passkey/finish", "/auth/passkey/register/challenge",
		"/auth/passkey/register", "/auth/lock", "/auth/unlock/challenge", "/auth/unlock", "/auth/google/move"} {
		req, _ := http.NewRequest(http.MethodPost, s.ts.URL+path, strings.NewReader(`{"phone":"+447700900008"}`))
		req.Header.Set("Origin", "https://evil.example")
		req.Header.Set("Sec-Fetch-Site", "cross-site")
		resp, err := s.ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("POST %s from another site: %d, want 403", path, resp.StatusCode)
		}
	}
	s.door.mu.Lock()
	defer s.door.mu.Unlock()
	if len(s.door.calls) != 0 {
		t.Fatalf("a cross-site POST reached Lens: %v", s.door.calls)
	}
}
