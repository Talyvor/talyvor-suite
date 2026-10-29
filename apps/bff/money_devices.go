package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// money_devices.go — B40.31: the phone app's device keys (Lens B40.4, B40.15), on this session's own token:
//
//	POST /api/money/devices/challenge                the one-time challenge the phone signs and binds its attestation to
//	GET  /api/money/devices                          the workspace's device keys, revoked ones included
//	POST /api/money/devices {platform, name, public_key, challenge, signature, attestation, assertion?}   keep the phone's key
//	POST /api/money/devices/{id}/revoke              its signatures are refused from now on
//	POST /api/money/devices/{id}/push-token {push_token}   the phone's APNs or FCM token ("" removes it)
//
// Lens decides everything: who may register, whether the attestation and signature hold, and where approvals are pushed.
// A refusal comes back with its sentence (lensRelay).

// handleMoneyDeviceChallenge — POST /api/money/devices/challenge.
func (a *app) handleMoneyDeviceChallenge(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/devices/challenge", nil)
}

// handleMoneyDevices — GET /api/money/devices lists them; POST registers one.
func (a *app) handleMoneyDevices(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/devices", nil)
	case http.MethodPost:
		var in struct {
			Platform    string `json:"platform"`
			Name        string `json:"name"`
			PublicKey   string `json:"public_key"`
			Challenge   string `json:"challenge"`
			Signature   string `json:"signature"`
			Attestation string `json:"attestation"`
			// B50.22: once the workspace has a key, one of them signs challenge (Lens B50.20).
			Assertion *passkeyAssertion `json:"assertion,omitempty"`
		}
		// An App Attest object or an Android certificate chain, base64url, runs to a few kilobytes.
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensDeviceKeyRegisterBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/devices", body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyDeviceRevoke — POST /api/money/devices/{id}/revoke.
func (a *app) handleMoneyDeviceRevoke(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "device id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/devices/"+url.PathEscape(id)+"/revoke", nil)
}

// handleMoneyDevicePushToken — POST /api/money/devices/{id}/push-token {push_token}.
func (a *app) handleMoneyDevicePushToken(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "device id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		// A pointer, as Lens's is: "" removes the token, and an absent one is refused there in its own words.
		PushToken *string `json:"push_token"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensDevicePushTokenBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/devices/"+url.PathEscape(id)+"/push-token", body)
}
