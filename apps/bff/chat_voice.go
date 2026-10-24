package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// chat_voice.go — B40.12: talking to Talyvor in Chat. The microphone's recording goes to Lens's transcription and the
// answer's words to Lens's speech (Lens B40.10), on the same narrow {proxy} session key Chat's questions use, so each is
// billed like any model call and counted as Chat's in Spend by feature. A payment said aloud is only prepared here;
// it is paid once the person approves it with a passkey on the approval card (money_requests.go).
//
//	POST /api/chat/voice/transcriptions  multipart {file}           → POST /v1/audio/transcriptions → {"text"}
//	POST /api/chat/voice/speech          {"input"}                  → POST /v1/audio/speech         → the audio
//	POST /api/money/payment-requests     {"voice", "items": [{payee_id, currency, amount_minor, reference}]}
//	                                     → POST /v1/money/payment-requests as client "voice" (or "chat"), Idempotency-Key passed on
//	GET  /api/money/payment-requests?status=pending_approval → GET /v1/money/payment-requests (B40.39) → {"requests": […]}

// voiceAudioMaxBytes is Lens's own limit on a recording (25 MB) with room for the multipart envelope.
const voiceAudioMaxBytes = 26 << 20

// handleVoiceTranscription — POST /api/chat/voice/transcriptions: the recording, as the browser sent it.
func (a *app) handleVoiceTranscription(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	// Lens reads the multipart form and refuses anything else in its own words.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, voiceAudioMaxBytes))
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "a recording can be at most 25 MB"})
		return
	}
	a.voiceRelay(w, r, t, "/v1/audio/transcriptions", body, r.Header.Get("Content-Type"))
}

// handleVoiceSpeech — POST /api/chat/voice/speech {"input"}: the words, spoken in Lens's default voice.
func (a *app) handleVoiceSpeech(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Input string `json:"input"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil || strings.TrimSpace(in.Input) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "there is nothing to say"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensSpeechBody: model, response_format, voice
	body, _ := json.Marshal(map[string]string{"input": in.Input})
	a.voiceRelay(w, r, t, "/v1/audio/speech", body, "application/json")
}

// voiceRelay sends one speech call to Lens on the session's chat key and relays its answer: the transcript's JSON or the
// audio, or Lens's refusal in its own words ("speech is not configured on this Lens", "not enough credit …").
func (a *app) voiceRelay(w http.ResponseWriter, r *http.Request, t tenant, path string, body []byte, contentType string) {
	key, err := a.sessionKeyFor(r.Context(), t)
	if err != nil {
		log.Printf("bff: voice credential: %v", err)
		var refused mintRefused
		if errors.As(err, &refused) {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens refused the chat credential", "code": chatCredentialRefusedCode})
			return
		}
		writeUpstreamFailure(w, "lens", err)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.lensBaseURL+path, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set(featureHeader, chatFeature)
	// The stream client: a minute of speech can take longer than the shared client's ten seconds.
	resp, err := a.streamClient.Do(req)
	if err != nil {
		log.Printf("bff: voice %s: %v", path, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		var refusal struct {
			Error string `json:"error"`
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens could not answer just now"
		}
		status := resp.StatusCode
		if status >= 500 && status != http.StatusServiceUnavailable {
			status = http.StatusBadGateway
		}
		writeJSON(w, status, map[string]string{"error": refusal.Error})
		return
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 32<<20))
}

// handleMoneyPaymentRequests — POST /api/money/payment-requests: a payment Chat prepared for the person to approve.
// Lens judges each item and moves no money; a request from voice always needs approval (Lens B40.3).
func (a *app) handleMoneyPaymentRequests(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method == http.MethodGet {
		// B40.39: the phone's Bills due. Only status goes up; Lens refuses any status but pending_approval.
		path := "/v1/money/payment-requests"
		if s := r.URL.Query().Get("status"); s != "" {
			path += "?" + url.Values{"status": {s}}.Encode()
		}
		a.agentBankRelayPath(w, r, t, http.MethodGet, path, nil)
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "GET, POST")
		return
	}
	// Only the item fields go up: a bank detail the browser sent is dropped, as Lens refuses one from an assistant.
	var in struct {
		Voice bool `json:"voice"`
		Items []struct {
			PayeeID     string `json:"payee_id"`
			Currency    string `json:"currency"`
			AmountMinor int64  `json:"amount_minor"`
			Reference   string `json:"reference"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || len(in.Items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a payment request needs at least one payment"})
		return
	}
	client := "chat"
	if in.Voice {
		client = "voice"
	}
	// UPSTREAM-BINDS-ONLY lensPaymentRequestBody: agent_id
	body, _ := json.Marshal(map[string]any{"client": client, "items": in.Items})
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/payment-requests", body)
}
