package main

// b61115_check_survives_restart_test.go — B61.115: a confirmed number survives a restart of the app. The check is
// sealed into its id, as sessions are (session_seal.go), so a deploy between "the code" and "Type it again" no longer
// sends the person back to the number; Lens still refuses a ticket it has seen used.

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"
)

// restart is a new app on the same configuration: every in-memory map is gone. The phone app's door (no Origin, no
// cookie) is what the tests use across it, so the new server's address does not matter.
func (s *doorSuite) restart() {
	s.t.Helper()
	auth, err := newAuthenticator(s.t.Context(), s.app.cfg)
	if err != nil {
		s.t.Fatalf("newAuthenticator: %v", err)
	}
	s.app = newApp(s.app.cfg, auth)
	s.ts = httptest.NewTLSServer(s.app)
	s.t.Cleanup(s.ts.Close)
}

func (s *doorSuite) reachedLens(since int) bool {
	s.door.mu.Lock()
	defer s.door.mu.Unlock()
	return slices.Contains(s.door.calls[since:], "/v1/auth/phone/person")
}

func (s *doorSuite) callCount() int {
	s.door.mu.Lock()
	defer s.door.mu.Unlock()
	return len(s.door.calls)
}

func TestB61115_ConfirmedNumberSurvivesARestart(t *testing.T) {
	s := startDoorSuite(t, nil)
	check, has := s.confirm(nil, "+447700900115")
	if has {
		t.Fatal("a new number reads as held")
	}
	s.door.mu.Lock()
	for ticket := range s.door.tickets {
		if strings.Contains(check, ticket) {
			t.Fatalf("the check id carries Lens's ticket in the clear: %q", check)
		}
	}
	s.door.mu.Unlock()
	if strings.Contains(check, "447700900115") {
		t.Fatalf("the check id carries the number in the clear: %q", check)
	}
	s.restart()
	before := s.callCount()
	st, out, _ := s.post(nil, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"})
	if st != http.StatusOK || out["signup_unfinished"] != true || out["token"] == nil {
		t.Fatalf("join with a check confirmed before the restart: %d %v, want 200 and a sign-up session", st, out)
	}
	if !s.reachedLens(before) {
		t.Fatal("the join did not reach Lens")
	}
}

func TestB61115_SpentCheckStaysSpentAcrossARestart(t *testing.T) {
	s := startDoorSuite(t, nil)
	check, _ := s.confirm(nil, "+447700900116")
	if st, out, _ := s.post(nil, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK {
		t.Fatalf("join: %d %v", st, out)
	}
	// In the same app the spent check is gone.
	if st, out, _ := s.post(nil, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusBadRequest || out["reason"] != "ticket_ended" {
		t.Fatalf("the spent check again, same app: %d %v, want 400 ticket_ended", st, out)
	}
	// After a restart its seal opens, Lens refuses the used ticket, and that refusal is the answer.
	s.restart()
	before := s.callCount()
	if st, out, _ := s.post(nil, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusBadRequest || out["reason"] != "ticket_ended" {
		t.Fatalf("the spent check after a restart: %d %v, want 400 ticket_ended", st, out)
	}
	if !s.reachedLens(before) {
		t.Fatal("a restored check skipped Lens's refusal")
	}
	// And Lens's refusal ended it here too: the next try does not reach Lens.
	before = s.callCount()
	if st, out, _ := s.post(nil, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusBadRequest || out["reason"] != "ticket_ended" || s.reachedLens(before) {
		t.Fatalf("the refused check once more: %d %v, want 400 ticket_ended without Lens", st, out)
	}
}

func TestB61115_TamperedExpiredOrForeignChecksAreRefused(t *testing.T) {
	s := startDoorSuite(t, nil)
	check, _ := s.confirm(nil, "+447700900117")
	s.restart()
	tampered := []byte(check)
	tampered[len(tampered)-3] ^= 1
	expired, err := newCheckSealer(testProvisionSecret).seal(phoneCheck{phone: "+447700900117", ticket: "t-expired",
		expires: time.Now().Add(-time.Second)})
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := newCheckSealer("another secret").seal(phoneCheck{phone: "+447700900117", ticket: "t-foreign",
		expires: time.Now().Add(5 * time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]string{"tampered": string(tampered), "expired": expired, "another secret's": foreign} {
		before := s.callCount()
		st, out, _ := s.post(nil, "", "/auth/phone/join", map[string]string{"check": id, "passcode": "418263"})
		if st != http.StatusBadRequest || out["reason"] != "ticket_ended" || s.reachedLens(before) {
			t.Errorf("a %s check: %d %v, want 400 ticket_ended without Lens", name, st, out)
		}
	}
	// The untouched check still joins.
	if st, out, _ := s.post(nil, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK {
		t.Fatalf("the untouched check: %d %v", st, out)
	}
}

func TestB61115_NoSecretNoSeal(t *testing.T) {
	if newCheckSealer("") != nil {
		t.Fatal("a check sealer without LENS_PROVISION_SECRET")
	}
}
