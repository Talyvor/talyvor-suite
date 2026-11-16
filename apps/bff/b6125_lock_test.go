package main

// b6125_lock_test.go — B61.25: the phone app's lock shuts by itself, after 2 minutes quiet or away, and on a session
// restored from its seal, so a copied token opens nothing once the app is away.

import (
	"net/http"
	"testing"
	"time"
)

func TestB6125_PhoneLockShutsAfterTwoMinutesAndOnRestore(t *testing.T) {
	s := startDoorSuite(t, nil)
	s.join(s.browser(), "+447700900009", "418263")
	signIn := func() string {
		check, _ := s.confirm(nil, "+447700900009")
		_, out, _ := s.post(nil, "", "/auth/phone/signin", map[string]string{"check": check, "passcode": "418263"})
		token, _ := out["token"].(string)
		if st, _ := s.get(nil, token, "/api/agents"); st != http.StatusOK {
			t.Fatalf("a phone session just signed in: %d", st)
		}
		return token
	}

	quiet := signIn()
	s.app.auth.sessions.update(quiet, func(v session) session { v.lastSeen = time.Now().Add(-phoneLockAfter); return v })
	if st, _ := s.get(nil, quiet, "/api/agents"); st != http.StatusLocked {
		t.Fatalf("a phone session quiet for 2 minutes: %d, want 423", st)
	}

	away := signIn()
	s.post(nil, away, "/auth/lock", map[string]string{"state": "away"})
	if st, _ := s.get(nil, away, "/api/agents"); st != http.StatusOK {
		t.Fatalf("back within 2 minutes: %d", st)
	}
	s.post(nil, away, "/auth/lock", map[string]string{"state": "away"})
	s.app.auth.sessions.update(away, func(v session) session { v.awayAt = time.Now().Add(-phoneLockAfter); return v })
	if st, _ := s.get(nil, away, "/api/agents"); st != http.StatusLocked {
		t.Fatalf("a phone session away for 2 minutes: %d, want 423", st)
	}

	// A restart: this process has not seen the token, and its seal brings the session back locked.
	restored := signIn()
	s.app.auth.sessions.delete(restored)
	s.app.auth.sealer = newSessionSealer(testProvisionSecret, time.Hour)
	if st, out := s.get(nil, restored, "/api/agents"); st != http.StatusLocked {
		t.Fatalf("a phone session restored from its seal: %d %v, want 423", st, out)
	}
	if st, _, _ := s.post(nil, restored, "/auth/unlock", map[string]string{"passcode": "418263"}); st != http.StatusNoContent {
		t.Fatalf("unlock after the restore: %d", st)
	}
	if st, _ := s.get(nil, restored, "/api/agents"); st != http.StatusOK {
		t.Fatalf("unlocked after the restore: %d", st)
	}
}
