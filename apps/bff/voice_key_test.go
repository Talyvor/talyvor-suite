package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"
)

// B58.10 — the phone asks the BFF for "Hey Taly"'s Picovoice access key after sign-in, so the app ships none.
// No session: 401 and no key. A signed-in phone: the key, never cached. No key on the server: voice is off, in one
// sentence. Over the limit: 429. The key never reaches a log line.
func TestVoiceKeyGoesOnlyToASignedInPhone(t *testing.T) {
	const pvKey = "pv-test-ACCESS-KEY-0123456789"
	var logs bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(prev) })
	t.Setenv("BFF_VOICE_KEY_PER_SESSION_HOUR", "3")
	t.Setenv("PICOVOICE_ACCESS_KEY", pvKey)

	idp := newFakeIDP(t)
	a, ts, _ := startOIDCBFF(t, idp, nil, func(c *config) {
		c.oidcMobileClientIDs = []string{"phone-ios"}
	})
	phone := &http.Client{Transport: ts.Client().Transport}
	get := func(bearer string) (int, string, http.Header) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, ts.URL+voiceKeyPath, nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := phone.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b), resp.Header
	}

	if code, body, _ := get(""); code != http.StatusUnauthorized || strings.Contains(body, pvKey) {
		t.Fatalf("no session: %d %s, want 401 without the key", code, body)
	}
	if code, body, _ := get("not-a-session"); code != http.StatusUnauthorized || strings.Contains(body, pvKey) {
		t.Fatalf("unknown Bearer: %d %s, want 401 without the key", code, body)
	}

	idp.aud = "phone-ios"
	resp, err := phone.Post(ts.URL+mobileSessionPath, "application/json",
		strings.NewReader(`{"id_token":"`+idp.mintIDToken("")+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	var signedIn struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&signedIn)
	resp.Body.Close()
	if signedIn.Token == "" {
		t.Fatalf("phone sign-in: status %d, no token", resp.StatusCode)
	}

	code, body, h := get(signedIn.Token)
	var got map[string]string
	_ = json.Unmarshal([]byte(body), &got)
	if code != http.StatusOK || got["access_key"] != pvKey || len(got) != 1 {
		t.Fatalf("signed-in phone: %d %s, want 200 {\"access_key\": the server's key}", code, body)
	}
	if cc := h.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}

	get(signedIn.Token)
	get(signedIn.Token)
	if code, body, h := get(signedIn.Token); code != http.StatusTooManyRequests || h.Get("Retry-After") == "" || strings.Contains(body, pvKey) {
		t.Errorf("fourth ask within the hour at a limit of 3: %d %s Retry-After=%q, want 429 without the key", code, body, h.Get("Retry-After"))
	}

	t.Setenv("PICOVOICE_ACCESS_KEY", "")
	a.oauth.hits = connectHits{}
	code, body, _ = get(signedIn.Token)
	if code != http.StatusServiceUnavailable || body != "{\"error\":\""+voiceOffSentence+"\"}\n" {
		t.Errorf("no key on the server: %d %s, want 503 with %q", code, body, voiceOffSentence)
	}

	if strings.Contains(logs.String(), pvKey) {
		t.Errorf("the voice key reached a log line:\n%s", logs.String())
	}
}
