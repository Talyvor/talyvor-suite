package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// B52.28 — Scan in the app (Lens B52.26, B52.27 and B52.33).
//
//	GET    /api/scan/reports?family=        published Scan reports, newest first; energy, oil, crops or filings only (public)
//	GET    /api/scan/reports/{id}           one published report: its sections, figures, sources and how it was made (public)
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

func (a *app) handleScanReports(w http.ResponseWriter, r *http.Request, _ tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	path := "/v1/public/scan/reports"
	switch f := r.URL.Query().Get("family"); f {
	case "":
	case "energy", "oil", "crops", "filings":
		path += "?family=" + f
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "family is energy, oil, crops or filings"})
		return
	}
	a.lensRelay(w, r, "", http.MethodGet, path, nil, "scan reports")
}

func (a *app) handleScanReport(w http.ResponseWriter, r *http.Request, _ tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "report id", r.PathValue("id"))
	if !ok {
		return
	}
	a.lensRelay(w, r, "", http.MethodGet, "/v1/public/scan/reports/"+url.PathEscape(id), nil, "scan report")
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
