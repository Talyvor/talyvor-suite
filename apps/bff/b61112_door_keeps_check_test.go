package main

// b61112_door_keeps_check_test.go — B61.112: a passcode Lens could not set leaves the confirmed number's check in
// place, and the person hears why in words; only Lens's refusals spend the check.

import (
	"net/http"
	"slices"
	"testing"
)

// Lens answers its passcode 503 as every 5xx: in generic words, with no reason (cmd/lens writeJSONErr).
var lensPasscodeDown = map[string]any{"error": "service unavailable"}

func TestB61112_JoinWhosePasscodeLensCannotSetKeepsTheCheck(t *testing.T) {
	s := startDoorSuite(t, nil)
	br := s.browser()
	check, _ := s.confirm(br, "+447700900112")
	s.door.mu.Lock()
	s.door.down["/v1/auth/phone/person"] = lensPasscodeDown
	s.door.mu.Unlock()
	st, out, _ := s.post(br, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"})
	if st != http.StatusServiceUnavailable || out["reason"] != "passcode_unavailable" || out["error"] != "We can't set passcodes just now. Try again in a few minutes." {
		t.Fatalf("join while Lens cannot set a passcode: %d %v, want 503 passcode_unavailable", st, out)
	}
	// The same check reaches Lens again, and once Lens can set the passcode the person joins.
	s.door.mu.Lock()
	delete(s.door.down, "/v1/auth/phone/person")
	before := len(s.door.calls)
	s.door.mu.Unlock()
	st, out, _ = s.post(br, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"})
	if st != http.StatusOK || out["signup_unfinished"] != true {
		t.Fatalf("the second join with the same check: %d %v", st, out)
	}
	s.door.mu.Lock()
	again := slices.Contains(s.door.calls[before:], "/v1/auth/phone/person")
	s.door.mu.Unlock()
	if !again {
		t.Fatal("the second join did not reach Lens")
	}
}

func TestB61112_LensUnreachableKeepsTheCheck(t *testing.T) {
	s := startDoorSuite(t, nil)
	br := s.browser()
	check, _ := s.confirm(br, "+447700900113")
	lens := s.app.cfg.lensBaseURL
	s.app.cfg.lensBaseURL = "http://127.0.0.1:1" // nothing listens
	if st, out, _ := s.post(br, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusBadGateway {
		t.Fatalf("join with Lens unreachable: %d %v, want 502", st, out)
	}
	s.app.cfg.lensBaseURL = lens
	if st, out, _ := s.post(br, "", "/auth/phone/join", map[string]string{"check": check, "passcode": "418263"}); st != http.StatusOK {
		t.Fatalf("the join after Lens came back: %d %v", st, out)
	}
}

func TestB61112_StartSaysPasscodesCannotBeSet(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.door.mu.Lock()
	s.door.down["/v1/auth/phone/start"] = map[string]any{"error": "Sign-up by phone isn't ready yet. Try again soon.", "reason": "passcode_unavailable"}
	s.door.mu.Unlock()
	st, out, _ := s.post(s.browser(), "", "/auth/phone/start", map[string]string{"phone": "+447700900114"})
	if st != http.StatusServiceUnavailable || out["reason"] != "passcode_unavailable" || out["error"] != "We can't set passcodes just now. Try again in a few minutes." || out["sandbox_code"] != nil {
		t.Fatalf("start while Lens cannot set a passcode: %d %v, want 503 passcode_unavailable", st, out)
	}
}
