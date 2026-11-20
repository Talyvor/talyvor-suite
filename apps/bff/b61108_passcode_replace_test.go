package main

// b61108_passcode_replace_test.go — B61.108: a forgotten passcode set again, for a locked or signed-out phone, through
// the real BFF against doorLens, which answers Lens's POST /v1/auth/passcode/replace (talyvor-lens B61.107) as
// cmd/lens does.

import (
	"net/http"
	"strings"
	"testing"
)

// replace answers Lens's forgotten-passcode route for doorLens: the number's ticket and a key sign-in ticket of the
// same person set the passcode and are spent; any refusal spends neither. d.mu is held.
func (d *doorLens) replace(w http.ResponseWriter, str func(string) string, refuse func(int, string)) {
	phone, ok := d.tickets[str("ticket")]
	if !ok {
		refuse(http.StatusBadRequest, "ticket_ended")
		return
	}
	p, held := d.people[phone]
	keyPerson, keyed := d.keyTickets[str("key_ticket")]
	switch {
	case !held:
		refuse(http.StatusNotFound, "no_person")
	case !keyed:
		refuse(http.StatusForbidden, "key_needed")
	case keyPerson != p.id:
		refuse(http.StatusForbidden, "not_same_person")
	case len(str("passcode")) != 6:
		refuse(http.StatusBadRequest, "weak_passcode")
	default:
		delete(d.tickets, str("ticket"))
		delete(d.keyTickets, str("key_ticket"))
		p.passcode = str("passcode")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "person": map[string]any{"id": p.id, "phone": phone, "identity": p.identity}})
	}
}

// keyAnswerFor signs challenge with device, as the phone's key does.
func keyAnswerFor(device, challenge string) map[string]string {
	return map[string]string{"device_id": device, "challenge": challenge, "signature": "signed:" + challenge}
}

// signsInWith reports whether passcode opens phone's account on a fresh browser.
func (s *doorSuite) signsInWith(phone, passcode string) bool {
	s.t.Helper()
	br := s.browser()
	check, _ := s.confirm(br, phone)
	st, _, _ := s.post(br, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": passcode})
	return st == http.StatusOK
}

func TestB61108_ASignedOutPhoneSetsANewPasscodeWithTheNumberAndItsKey(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900031", "418263")
	s.door.mu.Lock()
	s.door.people["+447700900031"].device = "dev-31"
	s.door.mu.Unlock()

	// The number alone, from the phone with no session: Lens's words, and the check kept.
	check, _ := s.confirm(nil, "+447700900031")
	st, out, _ := s.post(nil, "", "/auth/passcode/replace", map[string]string{"check": check, "passcode": "527094"})
	if st != http.StatusForbidden || out["reason"] != "key_needed" || out["error"] != "refused: key_needed" {
		t.Fatalf("a new passcode with no key: %d %v", st, out)
	}
	// The same check and Face ID on the door's challenge: the new passcode.
	_, out, _ = s.post(nil, "", "/auth/passkey/challenge", map[string]string{})
	challenge, _ := out["challenge"].(string)
	body := keyAnswerFor("dev-31", challenge)
	body["check"], body["passcode"] = check, "527094"
	if st, out, _ := s.post(nil, "", "/auth/passcode/replace", body); st != http.StatusNoContent {
		t.Fatalf("a new passcode with the number and the key: %d %v", st, out)
	}
	if b := s.door.body("/v1/auth/passcode/replace"); !strings.HasPrefix(b["ticket"].(string), "tkt-") ||
		!strings.HasPrefix(b["key_ticket"].(string), "ktk-") || b["passcode"] != "527094" || b["caller_address"] == "" {
		t.Fatalf("the new passcode at Lens: %v", b)
	}
	if st, out, _ := s.post(nil, "", "/auth/passcode/replace", map[string]string{"check": check, "passcode": "630172"}); st != http.StatusBadRequest || out["reason"] != "ticket_ended" {
		t.Fatalf("a spent check used again: %d %v", st, out)
	}
	if s.signsInWith("+447700900031", "418263") {
		t.Fatal("the forgotten passcode still opens the account")
	}
	if !s.signsInWith("+447700900031", "527094") {
		t.Fatal("the new passcode does not open the account")
	}
}

func TestB61108_ALockedPhoneReachesItAndNothingElse(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900032", "418263")
	s.join(s.browser(), "+447700900033", "630172")
	s.door.mu.Lock()
	s.door.people["+447700900032"].device = "dev-32"
	s.door.people["+447700900033"].device = "dev-33"
	s.door.mu.Unlock()
	check, _ := s.confirm(nil, "+447700900032")
	_, out, _ := s.post(nil, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"})
	token, _ := out["token"].(string)
	if st, _, _ := s.post(nil, token, "/auth/lock", map[string]string{"state": "closed"}); st != http.StatusNoContent {
		t.Fatalf("lock: %d", st)
	}

	// Another person's key on this phone's lock sets nothing.
	check, _ = s.confirm(nil, "+447700900032")
	_, out, _ = s.post(nil, "", "/auth/passkey/challenge", map[string]string{})
	other, _ := out["challenge"].(string)
	body := keyAnswerFor("dev-33", other)
	body["check"], body["passcode"] = check, "527094"
	if st, out, _ := s.post(nil, token, "/auth/passcode/replace", body); st != http.StatusUnauthorized || out["reason"] != "no_key" {
		t.Fatalf("another person's key at the lock: %d %v", st, out)
	}
	// The lock's own challenge, Face ID, and the number's check: the new passcode, and the lock stays shut.
	_, out, _ = s.post(nil, token, "/auth/unlock/challenge", map[string]string{})
	challenge, _ := out["challenge"].(string)
	body = keyAnswerFor("dev-32", challenge)
	body["check"], body["passcode"] = check, "527094"
	if st, out, _ := s.post(nil, token, "/auth/passcode/replace", body); st != http.StatusNoContent {
		t.Fatalf("a new passcode at the lock: %d %v", st, out)
	}
	if st, out := s.get(nil, token, "/api/agents"); st != http.StatusLocked || out["reason"] != "locked" {
		t.Fatalf("a locked phone read its agents after a new passcode: %d %v", st, out)
	}
	if st, out, _ := s.post(nil, token, "/auth/passcode/change", map[string]string{"old_passcode": "527094", "passcode": "740316"}); st != http.StatusLocked {
		t.Fatalf("a locked phone changed its passcode: %d %v", st, out)
	}
	if st, _, _ := s.post(nil, token, "/auth/unlock", map[string]string{"passcode": "527094"}); st != http.StatusNoContent {
		t.Fatalf("unlock with the new passcode: %d", st)
	}
}

func TestB61108_TheSessionsKeySignInIsTheKey(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900034", "418263")
	s.door.mu.Lock()
	s.door.people["+447700900034"].device = "dev-34"
	s.door.mu.Unlock()
	br := s.browser()
	_, out, _ := s.post(br, "", "/auth/passkey/challenge", map[string]string{})
	challenge, _ := out["challenge"].(string)
	if st, out, _ := s.post(br, "", "/auth/passkey/finish", keyAnswerFor("dev-34", challenge)); st != http.StatusOK {
		t.Fatalf("key sign-in: %d %v", st, out)
	}
	check, _ := s.confirm(br, "+447700900034")
	if st, out, _ := s.post(br, "", "/auth/passcode/replace", map[string]string{"check": check, "passcode": "527094"}); st != http.StatusNoContent {
		t.Fatalf("a new passcode on the session's key sign-in: %d %v", st, out)
	}
	if !s.signsInWith("+447700900034", "527094") {
		t.Fatal("the new passcode does not open the account")
	}
}
