package main

// b61105_settings_security_test.go — B61.105: Settings, Security's routes for a person's session — their sign-in keys,
// their passcode and their number — through the real BFF against doorLens, which answers Lens's routes for them
// (talyvor-lens B61.23, B61.24, B61.81, B61.104) as cmd/lens does.

import (
	"net/http"
	"slices"
	"strings"
	"testing"
)

// settings answers Lens's Settings, Security routes for doorLens. d.mu is held.
func (d *doorLens) settings(w http.ResponseWriter, path string, str func(string) string, refuse func(int, string)) {
	var (
		p     *doorPerson
		phone string
	)
	for ph, q := range d.people {
		if q.id == str("person_id") {
			p, phone = q, ph
		}
	}
	if p == nil {
		refuse(http.StatusNotFound, "no_person")
		return
	}
	switch path {
	case "/v1/auth/passkey/keys":
		keys := []map[string]string{}
		for _, id := range p.keys {
			keys = append(keys, map[string]string{"id": id, "kind": "device", "name": "iPhone"})
		}
		writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
	case "/v1/auth/passkey/keys/remove":
		switch {
		case !slices.Contains(p.keys, str("key_id")):
			refuse(http.StatusUnauthorized, "no_key")
		case str("key_ticket") == "" && (p.passcode == "" || str("passcode") != p.passcode):
			refuse(http.StatusForbidden, "proof_needed")
		case len(p.keys) == 1 && p.passcode == "":
			refuse(http.StatusConflict, "last_way_in")
		default:
			p.keys = slices.DeleteFunc(p.keys, func(id string) bool { return id == str("key_id") })
			writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
		}
	case "/v1/auth/passcode/change":
		switch {
		case str("old_passcode") != p.passcode:
			refuse(http.StatusBadRequest, "wrong_passcode")
		case len(str("passcode")) != 6:
			refuse(http.StatusBadRequest, "weak_passcode")
		default:
			p.passcode = str("passcode")
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		}
	case "/v1/auth/phone/change-number":
		next, ok := d.tickets[str("ticket")]
		_, held := d.people[next]
		switch {
		case !ok:
			refuse(http.StatusBadRequest, "ticket_ended")
		case str("passcode") != p.passcode:
			refuse(http.StatusBadRequest, "wrong_passcode")
		case held:
			refuse(http.StatusConflict, "held")
		default:
			delete(d.tickets, str("ticket"))
			delete(d.people, phone)
			d.people[next] = p
			writeJSON(w, http.StatusOK, map[string]any{"move_id": "nmv_1", "person": map[string]any{"id": p.id, "phone": next, "identity": p.identity}})
		}
	}
}

// keys reads the session's keys through br (nil: the phone with bearer) and answers their ids.
func (s *doorSuite) keys(br *http.Client, bearer string) []string {
	s.t.Helper()
	st, out := s.get(br, bearer, "/auth/passkey/keys")
	list, ok := out["keys"].([]any)
	if st != http.StatusOK || !ok {
		s.t.Fatalf("the keys: %d %v", st, out)
	}
	ids := []string{}
	for _, k := range list {
		id, _ := k.(map[string]any)["id"].(string)
		ids = append(ids, id)
	}
	return ids
}

func TestB61105_PersonListsAndRemovesTheirKeys(t *testing.T) {
	s := startDoorSuite(t, nil)
	br := s.browser()
	s.join(br, "+447700900021", "418263")
	if got := s.keys(br, ""); len(got) != 0 {
		t.Fatalf("a new person's keys: %v", got)
	}
	st, out, _ := s.post(br, "", "/auth/passkey/register", map[string]any{"name": "iPhone", "device": map[string]string{"public_key": "dev-21"}, "passcode": "418263"})
	key, _ := out["id"].(string)
	if st != http.StatusCreated || key == "" {
		t.Fatalf("add a key: %d %v", st, out)
	}
	if got := s.keys(br, ""); !slices.Equal(got, []string{key}) {
		t.Fatalf("the keys after one was added: %v, want [%s]", got, key)
	}
	if b := s.door.body("/v1/auth/passkey/keys"); b["person_id"] != "per_3" {
		t.Fatalf("the key list at Lens is not the session's person's: %v", b)
	}
	if st, out, _ := s.post(br, "", "/auth/passkey/keys/remove", map[string]string{"key_id": key}); st != http.StatusForbidden || out["reason"] != "proof_needed" || out["error"] != "refused: proof_needed" {
		t.Fatalf("a key removed with no proof: %d %v", st, out)
	}
	if st, out, _ := s.post(br, "", "/auth/passkey/keys/remove", map[string]string{"key_id": key, "passcode": "999111"}); st != http.StatusForbidden || out["reason"] != "proof_needed" {
		t.Fatalf("a key removed with a wrong passcode: %d %v", st, out)
	}
	if st, out, _ := s.post(br, "", "/auth/passkey/keys/remove", map[string]string{"key_id": key, "passcode": "418263"}); st != http.StatusOK || out["removed"] != true {
		t.Fatalf("a key removed with the passcode: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/passkey/keys/remove"); b["person_id"] != "per_3" || b["key_id"] != key || b["caller_address"] == "" {
		t.Fatalf("the removal at Lens: %v", b)
	}
	if got := s.keys(br, ""); len(got) != 0 {
		t.Fatalf("the keys after the removal: %v", got)
	}
}

func TestB61105_TheLastWayInIsNotRemoved(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900022", "418263")
	s.door.mu.Lock()
	p := s.door.people["+447700900022"]
	p.device, p.keys, p.passcode = "dev-22", []string{"pky_22"}, ""
	s.door.mu.Unlock()
	// The key sign-in's ticket is the proof, and the one key with no passcode is the last way in: Lens's words relayed.
	br := s.browser()
	_, out, _ := s.post(br, "", "/auth/passkey/challenge", map[string]string{})
	c, _ := out["challenge"].(string)
	if st, out, _ := s.post(br, "", "/auth/passkey/finish", map[string]string{"device_id": "dev-22", "challenge": c, "signature": "signed:" + c}); st != http.StatusOK {
		t.Fatalf("key sign-in: %d %v", st, out)
	}
	st, out, _ := s.post(br, "", "/auth/passkey/keys/remove", map[string]string{"key_id": "pky_22"})
	if st != http.StatusConflict || out["reason"] != "last_way_in" || out["error"] != "refused: last_way_in" {
		t.Fatalf("the last way in removed: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/passkey/keys/remove"); !strings.HasPrefix(b["key_ticket"].(string), "ktk-") {
		t.Fatalf("the session's key sign-in did not prove the removal: %v", b)
	}
	if got := s.keys(br, ""); !slices.Equal(got, []string{"pky_22"}) {
		t.Fatalf("the keys after a refused removal: %v", got)
	}
}

func TestB61105_PersonChangesTheirPasscode(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900023", "418263")
	check, _ := s.confirm(nil, "+447700900023")
	_, out, _ := s.post(nil, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"})
	token, _ := out["token"].(string)
	// The phone app, on its Bearer session.
	if st, out, _ := s.post(nil, token, "/auth/passcode/change", map[string]string{"old_passcode": "999111", "passcode": "527094"}); st != http.StatusBadRequest || out["reason"] != "wrong_passcode" {
		t.Fatalf("a change with a wrong passcode: %d %v", st, out)
	}
	if st, out, _ := s.post(nil, token, "/auth/passcode/change", map[string]string{"old_passcode": "418263", "passcode": "527094"}); st != http.StatusOK || out["changed"] != true {
		t.Fatalf("the change: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/passcode/change"); b["person_id"] != "per_3" || b["old_passcode"] != "418263" || b["passcode"] != "527094" || b["caller_address"] == "" {
		t.Fatalf("the change at Lens: %v", b)
	}
	br := s.browser()
	check, _ = s.confirm(br, "+447700900023")
	if st, out, _ := s.post(br, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusBadRequest || out["reason"] != "wrong_passcode" {
		t.Fatalf("the old passcode after the change: %d %v", st, out)
	}
	if st, out, _ := s.post(br, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "527094"}); st != http.StatusOK {
		t.Fatalf("the new passcode: %d %v", st, out)
	}
}

func TestB61105_PersonChangesTheirNumber(t *testing.T) {
	s := startDoorSuite(t, nil)
	br := s.browser()
	ws := s.join(br, "+447700900024", "418263")
	s.join(s.browser(), "+447700900025", "630172")

	// Another person's number, once its code is right: Lens's words, and the check kept for nothing else.
	held, _ := s.confirm(br, "+447700900025")
	if st, out, _ := s.post(br, "", "/auth/phone/change-number", map[string]string{"check": held, "passcode": "418263"}); st != http.StatusConflict || out["reason"] != "held" {
		t.Fatalf("a change onto another person's number: %d %v", st, out)
	}
	check, _ := s.confirm(br, "+447700900026")
	if st, out, _ := s.post(br, "", "/auth/phone/change-number", map[string]string{"check": check, "passcode": "999111"}); st != http.StatusBadRequest || out["reason"] != "wrong_passcode" {
		t.Fatalf("a change with a wrong passcode: %d %v", st, out)
	}
	// A wrong passcode leaves Lens's ticket unused, so the same check goes on to the change.
	if st, out, _ := s.post(br, "", "/auth/phone/change-number", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK || out["changed"] != true || out["phone"] != "+447700900026" {
		t.Fatalf("the change: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/phone/change-number"); b["person_id"] != "per_3" || !strings.HasPrefix(b["ticket"].(string), "tkt-") || b["caller_address"] == "" {
		t.Fatalf("the change at Lens: %v", b)
	}
	if st, out, _ := s.post(br, "", "/auth/phone/change-number", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusBadRequest || out["reason"] != "ticket_ended" {
		t.Fatalf("a spent check used again: %d %v", st, out)
	}
	// The new number and the passcode open the same account; the old number holds nobody.
	other := s.browser()
	check, has := s.confirm(other, "+447700900026")
	if !has {
		t.Fatal("the new number holds nobody")
	}
	if st, out, _ := s.post(other, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK || out["account_id"] != ws {
		t.Fatalf("the new number's sign-in: %d %v, want %s", st, out, ws)
	}
	if _, has := s.confirm(s.browser(), "+447700900024"); has {
		t.Fatal("the old number still holds the person")
	}
}

func TestB61105_ASessionWithoutAPersonIsRefused(t *testing.T) {
	s := startDoorSuite(t, nil)
	google := s.signUp("google-sub-27", "maya@example.org")
	routes := []struct{ method, path string }{{http.MethodGet, passkeyKeysPath}, {http.MethodPost, passkeyKeyRemovePath},
		{http.MethodPost, passcodeChangePath}, {http.MethodPost, phoneChangeNumberPath}}
	for _, rt := range routes {
		var (
			st  int
			out map[string]any
		)
		if rt.method == http.MethodGet {
			st, out = s.get(google, "", rt.path)
		} else {
			st, out, _ = s.post(google, "", rt.path, map[string]string{"key_id": "pky_1", "passcode": "418263", "old_passcode": "418263", "check": "x"})
		}
		if st != http.StatusConflict || out["reason"] != "phone_needed" {
			t.Errorf("%s %s with a Google session and no number: %d %v, want 409 phone_needed", rt.method, rt.path, st, out)
		}
		if rt.method == http.MethodGet {
			st, _ = s.get(s.browser(), "", rt.path)
		} else {
			st, _, _ = s.post(s.browser(), "", rt.path, map[string]string{})
		}
		if st != http.StatusUnauthorized {
			t.Errorf("%s %s with no session: %d, want 401", rt.method, rt.path, st)
		}
	}
	s.door.mu.Lock()
	defer s.door.mu.Unlock()
	if len(s.door.calls) != 0 {
		t.Fatalf("a session without a person reached Lens: %v", s.door.calls)
	}
}

func TestB61105_ACrossSitePostIsRefused(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900028", "418263")
	br := s.browser()
	check, _ := s.confirm(br, "+447700900028")
	if st, out, _ := s.post(br, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK {
		t.Fatalf("sign-in: %d %v", st, out)
	}
	s.door.mu.Lock()
	before := len(s.door.calls)
	s.door.mu.Unlock()
	for _, path := range []string{passkeyKeyRemovePath, passcodeChangePath, phoneChangeNumberPath} {
		req, _ := http.NewRequest(http.MethodPost, s.ts.URL+path, strings.NewReader(`{"key_id":"pky_1","old_passcode":"418263","passcode":"527094"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://evil.example")
		req.Header.Set("Sec-Fetch-Site", "cross-site")
		resp, err := br.Do(req) // the person's own cookie rides along
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
	if len(s.door.calls) != before {
		t.Fatalf("a cross-site POST reached Lens: %v", s.door.calls[before:])
	}
}
