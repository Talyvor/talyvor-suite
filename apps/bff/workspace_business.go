package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
)

// workspace_business.go — B59.31: a Business workspace's company details and the people with control, ready for the
// partner's identity check (SPEC 6 (4), Lens B59.30).
//
//	GET /api/workspace/business  → GET /v1/workspaces/{ws}/business   {company_name, registration_number, country, people}
//	PUT /api/workspace/business  → PUT /v1/workspaces/{ws}/business   the same, replacing what was saved
//
// Each person is {name, role, share_bps}: role is director, shareholder or other, share_bps hundredths of a percent.
// Lens decides who may read or change them (the owner alone, on their own session) and checks every value; a Personal
// workspace has none, and Lens's 404 with code not_business is passed on so the screen can say so. The workspace is
// the session's (lensWorkspacePath), never one the request names. No identity document is asked for or sent.

// businessPerson is one person with control, as the screen sends and shows it.
type businessPerson struct {
	Name     string `json:"name"`
	Role     string `json:"role"`
	ShareBps int    `json:"share_bps"`
}

// businessDetails is the company record, as the screen sends and shows it: Lens's workspace id and who saved it last
// stay in Lens.
type businessDetails struct {
	CompanyName        string           `json:"company_name"`
	RegistrationNumber string           `json:"registration_number"`
	Country            string           `json:"country"`
	People             []businessPerson `json:"people"`
}

// handleWorkspaceBusiness — GET reads the company details; PUT saves them.
func (a *app) handleWorkspaceBusiness(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.relayWorkspaceBusiness(w, r, t, http.MethodGet, nil)
	case http.MethodPut:
		var in businessDetails
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		if in.People == nil {
			in.People = []businessPerson{}
		}
		// UPSTREAM-BINDS-ONLY lensWorkspaceBusinessBody: updated_at, updated_by, workspace_id
		body, _ := json.Marshal(map[string]any{"company_name": in.CompanyName, "registration_number": in.RegistrationNumber, "country": in.Country, "people": in.People})
		a.relayWorkspaceBusiness(w, r, t, http.MethodPut, body)
	default:
		methodNotAllowed(w, "GET, PUT")
	}
}

// relayWorkspaceBusiness sends method (and body) to Lens's business route on the session's workspace and answers the
// record, Lens's refusal in its own words, or not_business for a Personal workspace.
func (a *app) relayWorkspaceBusiness(w http.ResponseWriter, r *http.Request, t tenant, method string, body []byte) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, a.cfg.lensBaseURL+lensWorkspacePath(t, "/business"), rd)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: workspace business: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var got businessDetails
	var refusal struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	switch {
	case resp.StatusCode == http.StatusOK && json.Unmarshal(raw, &got) == nil:
		if got.People == nil {
			got.People = []businessPerson{}
		}
		writeJSON(w, http.StatusOK, got)
	case resp.StatusCode == http.StatusNotFound && json.Unmarshal(raw, &refusal) == nil && refusal.Code == "not_business":
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "a Personal account has no company details", "code": "not_business"})
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}
