package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B28.68 — a lost phone is locked out through the BFF: the phone's keys reach Lens by name and nothing else does, a
// lockdown naming no key never reaches Lens (Lens would lock out every key), and a lift Lens refuses comes back in its words.
func TestLostPhoneLockdownReachesLensWithThePhonesKeysOnly(t *testing.T) {
	var mu sync.Mutex
	bodies := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies[r.Method+" "+r.URL.Path] = string(raw)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "GET /v1/money/lockdown":
			_, _ = w.Write([]byte(`{"active":false}`))
		case "POST /v1/money/lockdown":
			_, _ = w.Write([]byte(`{"active":true,"revoked_devices":["dk_1"],"revoked_passkeys":[],"frozen_cards":2}`))
		case "POST /v1/money/lockdown/lift":
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"economy: lifting the lockdown takes an identity check of the workspace's person, passed since it began"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/lockdown", `{"reason":"lost phone"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("a lockdown naming no key = %d %s, want 400", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/lockdown", `{"device_ids":["dk_1"],"reason":"lost phone","by":"x"}`); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), `"revoked_devices":["dk_1"]`) {
		t.Fatalf("lockdown = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/lockdown", ``); rec.Code != http.StatusOK {
		t.Fatalf("read = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/lockdown/lift", ``); rec.Code != http.StatusForbidden ||
		!strings.Contains(rec.Body.String(), "takes an identity check") {
		t.Fatalf("a lift Lens refuses = %d %s, want 403 in Lens's words", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if got := bodies["POST /v1/money/lockdown"]; got != `{"device_ids":["dk_1"],"reason":"lost phone"}` {
		t.Errorf("the lockdown reached Lens as %s, want the phone's key and the reason and nothing else", got)
	}
}
