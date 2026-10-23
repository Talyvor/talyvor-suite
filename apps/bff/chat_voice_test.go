package main

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// B40.12 — Chat's voice: the recording and the words to speak reach Lens's speech routes on the session's chat key, tagged
// Chat's; Lens's "not configured" comes back in its own words; a payment said aloud is prepared as client "voice" with
// only the item fields, under the browser's Idempotency-Key.
func TestChatVoiceReachesLensSpeechAndPreparesAsVoice(t *testing.T) {
	var mu sync.Mutex
	got := map[string]string{}
	speechConfigured := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case provisionPath:
			serveFakeProvision(w, r)
			return
		case lensSessionKeyPath:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"key":%q,"id":"sk-1","expires_at":%q}`, testSessionKey, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
			return
		}
		mu.Lock()
		defer mu.Unlock()
		seen := r.Header.Get("Authorization") + " feature=" + r.Header.Get(featureHeader) + " key=" + r.Header.Get("Idempotency-Key")
		switch r.URL.Path {
		case "/v1/audio/transcriptions":
			f, _, err := r.FormFile("file")
			if err != nil {
				http.Error(w, `{"error":"no file"}`, http.StatusBadRequest)
				return
			}
			audio, _ := io.ReadAll(f)
			got["listen"] = seen + " audio=" + string(audio)
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"text":"what did my agents spend this week?"}`)
		case "/v1/audio/speech":
			raw, _ := io.ReadAll(r.Body)
			got["speak"] = seen + " " + string(raw)
			if !speechConfigured {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = io.WriteString(w, `{"error":"speech is not configured on this Lens"}`)
				return
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = io.WriteString(w, "ID3-spoken")
		case "/v1/money/payment-requests":
			raw, _ := io.ReadAll(r.Body)
			got["prepare"] = seen + " " + string(raw)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"preq_1","status":"pending_approval"}`)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	var form bytes.Buffer
	mw := multipart.NewWriter(&form)
	part, _ := mw.CreateFormFile("file", "speech.webm")
	_, _ = part.Write([]byte("RIFF-recorded"))
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/voice/transcriptions", &form)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "what did my agents spend this week?") {
		t.Fatalf("transcription = %d %s", rec.Code, rec.Body.String())
	}

	if rec := doJSON(a, http.MethodPost, "/api/chat/voice/speech", `{"input":"Your agents spent £4.20.","voice":"x"}`); rec.Code != http.StatusOK ||
		rec.Header().Get("Content-Type") != "audio/mpeg" || rec.Body.String() != "ID3-spoken" {
		t.Fatalf("speech = %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	speechConfigured = false
	if rec := doJSON(a, http.MethodPost, "/api/chat/voice/speech", `{"input":"Hello"}`); rec.Code != http.StatusServiceUnavailable ||
		!strings.Contains(rec.Body.String(), "speech is not configured on this Lens") {
		t.Fatalf("unconfigured speech = %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/money/payment-requests",
		strings.NewReader(`{"voice":true,"client":"mcp:x","items":[{"payee_id":"payee_1","currency":"GBP","amount_minor":12000,"reference":"ACME invoice","iban":"GB00"}]}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "voice-1")
	rec = httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("prepare = %d %s", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	chatKey := "Bearer " + testSessionKey + " feature=chat"
	if !strings.HasPrefix(got["listen"], chatKey) || !strings.HasSuffix(got["listen"], "audio=RIFF-recorded") {
		t.Errorf("the recording reached Lens as %q", got["listen"])
	}
	if !strings.HasPrefix(got["speak"], chatKey) || !strings.HasSuffix(got["speak"], ` {"input":"Hello"}`) {
		t.Errorf("the words reached Lens as %q, want only the input on the chat key", got["speak"])
	}
	want := ` key=voice-1 {"client":"voice","items":[{"payee_id":"payee_1","currency":"GBP","amount_minor":12000,"reference":"ACME invoice"}]}`
	if !strings.HasSuffix(got["prepare"], want) || strings.Contains(got["prepare"], testSessionKey) {
		t.Errorf("the payment reached Lens as %q, want the session token and%s", got["prepare"], want)
	}
}
