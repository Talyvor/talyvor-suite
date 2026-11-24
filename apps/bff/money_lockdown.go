package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// money_lockdown.go — B28.68: a lost phone, locked out from the web (Lens B41.116), on this session's own token:
//
//	GET  /api/money/lockdown        {"active", "started_at", "started_by", "reason"}
//	POST /api/money/lockdown        {"device_ids", "passkey_ids", "reason"}: the named keys stop signing at once, the last
//	                                one included, every agent card freezes, every agent pauses and every other sign-in ends
//	POST /api/money/lockdown/lift   once an identity check passed since it began, from this same sign-in
//
// With the lost phone's key the workspace's only one, nothing else can remove it (Lens keeps the last key), so this is
// what lets the recovery code add a new passkey (key_recovery.go). Lens decides who may do each and says why it refuses.

// handleMoneyLockdown — GET /api/money/lockdown reads it; POST locks the named keys out.
func (a *app) handleMoneyLockdown(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/lockdown", nil)
	case http.MethodPost:
		var in struct {
			DeviceIDs  []string `json:"device_ids,omitempty"`
			PasskeyIDs []string `json:"passkey_ids,omitempty"`
			Reason     string   `json:"reason,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// Lens locks out every key when none is named; from here a person always names the keys of the phone they lost.
		if len(in.DeviceIDs) == 0 && len(in.PasskeyIDs) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name the lost phone's keys"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensLockdownBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/lockdown", body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyLockdownLift — POST /api/money/lockdown/lift.
func (a *app) handleMoneyLockdownLift(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/lockdown/lift", nil)
}
