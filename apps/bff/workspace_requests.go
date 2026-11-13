package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"
)

// workspace_requests.go — B59.28: help and complaints, closing the account and the workspace's data, each a request a
// person at Talyvor answers (Lens B59.27).
//
//	GET  /api/workspace/requests                  → GET  /v1/workspaces/{ws}/requests              {"requests":[...]}, newest first
//	POST /api/workspace/requests {kind, message}  → POST /v1/workspaces/{ws}/requests              the request as filed (201);
//	                                                                                               409 names the balances
//	GET  /api/workspace/requests/{id}/export      → GET  /v1/workspaces/{ws}/requests/{id}/export  the data file, once Talyvor
//	                                                                                               marked the request done
//
// Lens decides who may file which kind: support and complaints anyone's signed in to the workspace, closing the
// account and the data the owner's. The workspace is the session's (lensWorkspacePath), never one the request names.
// A request reaches the browser with what the screen shows: the workspace's id and who filed it stay in Lens.

// workspaceRequestKinds are the five kinds Lens files; anything else is refused here, before Lens.
var workspaceRequestKinds = map[string]bool{
	"support": true, "complaint": true, "account_closure": true, "data_export": true, "data_deletion": true,
}

// workspaceRequest is one request as the screen shows it.
type workspaceRequest struct {
	ID        int64     `json:"id"`
	Kind      string    `json:"kind"`
	State     string    `json:"state"`
	Reference string    `json:"reference"`
	Message   string    `json:"message"`
	Answer    string    `json:"answer"`
	FiledAt   time.Time `json:"filed_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// handleWorkspaceRequests — GET lists the workspace's requests; POST files one.
func (a *app) handleWorkspaceRequests(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/requests"))
		if err != nil {
			writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not read this workspace's requests"})
			return
		}
		var got struct {
			Requests []workspaceRequest `json:"requests"`
		}
		if err := json.Unmarshal(raw, &got); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not read this workspace's requests"})
			return
		}
		if got.Requests == nil {
			got.Requests = []workspaceRequest{}
		}
		writeJSON(w, http.StatusOK, map[string][]workspaceRequest{"requests": got.Requests})
	case http.MethodPost:
		var in struct {
			Kind    string `json:"kind"`
			Message string `json:"message"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		if !workspaceRequestKinds[in.Kind] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a request is support, complaint, account_closure, data_export or data_deletion"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensWorkspaceRequestBody: none
		body, _ := json.Marshal(map[string]string{"kind": in.Kind, "message": in.Message})
		a.fileWorkspaceRequest(w, r, t, body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// fileWorkspaceRequest sends the request to Lens and answers what it filed, or its refusal: a closure refused while the
// account holds money keeps Lens's balances, by currency in minor units, so the screen can name each one.
func (a *app) fileWorkspaceRequest(w http.ResponseWriter, r *http.Request, t tenant, body []byte) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.lensBaseURL+lensWorkspacePath(t, "/requests"), bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: workspace request: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var filed workspaceRequest
	var refusal struct {
		Error    string           `json:"error"`
		Code     string           `json:"code"`
		Balances map[string]int64 `json:"balances"`
	}
	switch {
	case resp.StatusCode == http.StatusCreated && json.Unmarshal(raw, &filed) == nil && filed.ID != 0:
		writeJSON(w, http.StatusCreated, filed)
	case resp.StatusCode == http.StatusConflict && json.Unmarshal(raw, &refusal) == nil && refusal.Code == "balances_not_empty":
		writeJSON(w, http.StatusConflict, map[string]any{"error": refusal.Error, "code": refusal.Code, "balances": refusal.Balances})
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}

// handleWorkspaceRequestExport — GET: the workspace's data file, passed through as Lens sends it (a download, never a
// page), or Lens's refusal while the export is not ready.
func (a *app) handleWorkspaceRequestExport(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such request"})
		return
	}
	path := lensWorkspacePath(t, "/requests/"+strconv.FormatInt(id, 10)+"/export")
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.cfg.lensBaseURL+path, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: workspace export: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusOK:
		relayContentType(w.Header(), resp.Header)
		w.Header().Set("Content-Disposition", `attachment; filename="talyvor-data.json"`)
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, resp.Body)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		var refusal struct {
			Error string `json:"error"`
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}
