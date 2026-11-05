package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// B52.28 — Scan in the app (Lens B52.26 and B52.27).
//
//	GET    /api/scan/track-record           every published Scan report, its range and, once known, the outcome (public)
//	GET    /api/scan/watches                the workspace's Scan agents' watches, each with its last 20 alerts
//	POST   /api/agents/{id}/scan-watches    {series, rule, z} — give an agent a watch; its wallet pays for each alert
//	DELETE /api/scan/watches/{id}           stop a watch
func (a *app) handleScanTrackRecord(w http.ResponseWriter, r *http.Request, _ tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, "", http.MethodGet, "/v1/public/scan/track-record", nil, "scan track record")
}

func (a *app) handleScanWatches(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/scan-watches", nil)
}

func (a *app) handleScanWatchStop(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	id, ok := pathID(w, "watch id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodDelete, "/scan-watches/"+url.PathEscape(id), nil)
}

func (a *app) handleAgentScanWatch(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "scan-watches")
	if !ok {
		return
	}
	var in struct {
		Series []string `json:"series"`
		Rule   string   `json:"rule"`
		Z      *float64 `json:"z"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensScanWatchBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}
