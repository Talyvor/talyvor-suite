package main

import (
	"math"
	"net/http"
	"os"
	"strconv"
	"time"
)

// voice_key.go — B58.10: "Hey Taly"'s Picovoice access key, handed to a signed-in phone at run time so the app
// ships none (an EXPO_PUBLIC_ value is written into the app, where anyone can read it).
//
//	GET /api/voice/key → 200 {"access_key"}             signed in, the server holds PICOVOICE_ACCESS_KEY
//	                   → 503 {"error":"Hey Taly is off."} no key on this server
//	                   → 429 + Retry-After               over BFF_VOICE_KEY_PER_SESSION_HOUR for this person
//
// The key comes from the server's environment, read on each request, never the repo. Picovoice issues one long-lived access key per
// account and offers no short-lived or device-bound ones, so this is that key; the phone keeps it in memory only.
// The answer is no-store and the key is never logged.
const (
	voiceKeyPath     = "/api/voice/key"
	voiceOffSentence = "Hey Taly is off."
)

// limitVoiceKey is how often one signed-in person may ask for the key: a setting for Nicolai to confirm; the
// fallback holds until it is set. The phone asks once per sign-in and app start.
var limitVoiceKey = connectLimit{"voice-key", func() string { return os.Getenv("BFF_VOICE_KEY_PER_SESSION_HOUR") },
	20, time.Hour}

func (a *app) handleVoiceKey(w http.ResponseWriter, r *http.Request, _ tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	who := "dev" // auth disabled: the loopback-only developer
	if a.auth != nil {
		if s, ok := a.auth.sessionFrom(r); ok {
			who = s.sub
		}
	}
	if wait, ok := a.oauth.hits.take(limitVoiceKey, who, time.Now()); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(wait.Seconds())))))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many requests. Try again later."})
		return
	}
	key := os.Getenv("PICOVOICE_ACCESS_KEY")
	if key == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": voiceOffSentence})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"access_key": key})
}
