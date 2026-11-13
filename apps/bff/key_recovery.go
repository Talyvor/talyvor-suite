package main

import (
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// key_recovery.go — B55.54: the web's half of Lens's B55.48. A workspace gets a recovery code with its first key, shown
// once, and can make a new one signed by a key it has; a workspace whose every key was removed gets one back with that
// code at once, or after 72 hours that everyone in the workspace is told about and can cancel.
//
//	POST /api/agents/keys/recovery-code/challenge  the challenge a new code is signed over
//	POST /api/agents/keys/recovery-code            {assertion}: a new code, shown once; the old one stops working
//	GET  /api/agents/keys/recover                  {recovery}: the waiting recovery, or null
//	POST /api/agents/keys/recover                  {code, passkey | device}: the key at once, and a new code
//	POST /api/agents/keys/recover/start            a key can be added from 72 hours on
//	POST /api/agents/keys/recover/cancel           any owner or admin
//	POST /api/agents/keys/recover/complete         {passkey | device}: from that time, for 24 hours
//
// Every recovery route goes to Lens with the session's sign-in time as X-Talyvor-Signed-In-At, which Lens reads on
// these routes alone. Recover, start and complete need a sign-in within the last 10 minutes: without one the BFF does
// not relay the call and answers Lens's own sentence, so the page asks the owner to sign in again first. Lens judges
// the same age again; the BFF only never sends one it knows is refused.

// signedInAtHeader carries the session's sign-in time to Lens's key recovery routes.
const signedInAtHeader = "X-Talyvor-Signed-In-At"

// recoverySignInAge is how long ago the owner may have signed in to get a key back; Lens holds the same 10 minutes.
const recoverySignInAge = 10 * time.Minute

// signInAgainSentence is Lens's own refusal for a sign-in that is too old (Lens cmd/lens/key_recovery_handler.go).
const signInAgainSentence = "Sign in again, then try again."

// recoveryPasskeyBody is a new passkey a recovery adds, as Lens's POST …/agents/passkeys takes it, all base64url.
type recoveryPasskeyBody struct {
	CredentialID      string `json:"credential_id"`
	Name              string `json:"name"`
	PublicKey         string `json:"public_key"`
	ClientDataJSON    string `json:"client_data_json"`
	AuthenticatorData string `json:"authenticator_data"`
}

// recoveryDeviceBody is a new phone key a recovery adds, as Lens's POST /v1/money/devices takes it, all base64url.
type recoveryDeviceBody struct {
	Platform    string `json:"platform"`
	Name        string `json:"name"`
	PublicKey   string `json:"public_key"`
	Challenge   string `json:"challenge"`
	Signature   string `json:"signature"`
	Attestation string `json:"attestation"`
}

// recoveryRelay sends one recovery call to Lens with the session's sign-in time.
func (a *app) recoveryRelay(w http.ResponseWriter, r *http.Request, t tenant, method, suffix string, body []byte) {
	var extra http.Header
	if !t.signedInAt.IsZero() {
		extra = http.Header{signedInAtHeader: {t.signedInAt.UTC().Format(time.RFC3339Nano)}}
	}
	path := lensWorkspacePath(t, suffix)
	a.lensRelayHeaders(w, r, t.token, method, path, body, "application/json", suffix, extra)
}

// signedInRecently is whether t's person signed in within recoverySignInAge; if not, the page is told to sign in again.
func signedInRecently(w http.ResponseWriter, t tenant) bool {
	if age := time.Since(t.signedInAt); t.signedInAt.IsZero() || age > recoverySignInAge {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": signInAgainSentence})
		return false
	}
	return true
}

// handleRecoveryCode — POST /api/agents/keys/recovery-code/challenge and POST /api/agents/keys/recovery-code.
func (a *app) handleRecoveryCode(suffix string) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		var body []byte
		if suffix == "" {
			var in struct {
				Assertion *passkeyAssertion `json:"assertion"`
			}
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Assertion == nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a new recovery code needs a key the workspace has to sign it"})
				return
			}
			// UPSTREAM-BINDS-ONLY lensRecoveryCodeBody: none
			body, _ = json.Marshal(in)
		}
		a.recoveryRelay(w, r, t, http.MethodPost, "/keys/recovery-code"+suffix, body)
	}
}

// handleKeyRecover — GET /api/agents/keys/recover reads the waiting recovery; POST gets a key back with the code.
func (a *app) handleKeyRecover(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.recoveryRelay(w, r, t, http.MethodGet, "/keys/recover", nil)
	case http.MethodPost:
		if !signedInRecently(w, t) {
			return
		}
		a.relayRecoveryKey(w, r, t, "/keys/recover")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleKeyRecoverAction — POST /api/agents/keys/recover/start, …/cancel and …/complete.
func (a *app) handleKeyRecoverAction(action string) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		switch action {
		case "cancel": // any owner or admin, however long ago they signed in
			a.recoveryRelay(w, r, t, http.MethodPost, "/keys/recover/cancel", nil)
		case "start":
			if signedInRecently(w, t) {
				a.recoveryRelay(w, r, t, http.MethodPost, "/keys/recover/start", nil)
			}
		default:
			if signedInRecently(w, t) {
				a.relayRecoveryKey(w, r, t, "/keys/recover/complete")
			}
		}
	}
}

// relayRecoveryKey sends the new key (and the code, for /keys/recover) rebuilt field by field.
func (a *app) relayRecoveryKey(w http.ResponseWriter, r *http.Request, t tenant, suffix string) {
	var in struct {
		Code    string               `json:"code,omitempty"`
		Passkey *recoveryPasskeyBody `json:"passkey,omitempty"`
		Device  *recoveryDeviceBody  `json:"device,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if suffix != "/keys/recover" {
		in.Code = ""
	}
	// UPSTREAM-BINDS-ONLY lensKeyRecoverBody: none
	body, _ := json.Marshal(in)
	a.recoveryRelay(w, r, t, http.MethodPost, suffix, body)
}
