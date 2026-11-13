package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeLensRequests answers Lens B59.27's request routes for the dev session's own workspace and token only; any other
// workspace or credential gets Lens's 404. It records each call with the body Lens was sent.
func fakeLensRequests(t *testing.T, serve func(w http.ResponseWriter, r *http.Request, body string), calls *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		*calls = append(*calls, r.Method+" "+strings.TrimPrefix(r.URL.Path, "/v1/workspaces/"+own)+" "+string(raw))
		if !strings.HasPrefix(r.URL.Path, "/v1/workspaces/"+own+"/requests") || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
			http.NotFound(w, r)
			return
		}
		serve(w, r, string(raw))
	}))
	t.Cleanup(srv.Close)
	return newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)
}

const lensFiledComplaint = `{"id":7,"workspace_id":"ws_x","kind":"complaint","state":"received","reference":"C-ABCD-EFGH",` +
	`"filed_by":"user:u_1","message":"A card payment was taken twice","answer":"","filed_at":"2026-11-12T09:00:00Z","updated_at":"2026-11-12T09:00:00Z"}`

// B59.28 — a complaint is sent to Lens with its kind and message only, for the session's own workspace, and comes back
// with its reference; the workspace's id and who filed it stay in Lens.
func TestWorkspaceRequestFilesAComplaintWithItsReference(t *testing.T) {
	var calls []string
	a := fakeLensRequests(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, lensFiledComplaint)
	}, &calls)
	rec := doJSON(a, http.MethodPost, "/api/workspace/requests",
		`{"kind":"complaint","message":"A card payment was taken twice","workspace_id":"SOMEBODY-ELSE","filed_by":"x"}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/workspace/requests = %d %s", rec.Code, rec.Body.String())
	}
	if want := `POST /requests {"kind":"complaint","message":"A card payment was taken twice"}`; len(calls) != 1 || calls[0] != want {
		t.Errorf("Lens was sent %q, want %q", calls, want)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["reference"] != "C-ABCD-EFGH" || got["state"] != "received" {
		t.Errorf("answer = %v, want the reference and received", got)
	}
	if _, ok := got["workspace_id"]; ok {
		t.Errorf("answer carries workspace_id: %v", got)
	}
	if _, ok := got["filed_by"]; ok {
		t.Errorf("answer carries filed_by: %v", got)
	}
}

// Closing an account that still holds money is refused with Lens's balances, by currency, so the screen names each.
func TestWorkspaceRequestClosureRefusalKeepsTheBalances(t *testing.T) {
	var calls []string
	a := fakeLensRequests(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = io.WriteString(w, `{"error":"support: the account still holds 1250 GBP (in minor units): move it out before closing the account",`+
			`"code":"balances_not_empty","field":"balances","balances":{"GBP":1250,"USDC":3000000}}`)
	}, &calls)
	rec := doJSON(a, http.MethodPost, "/api/workspace/requests", `{"kind":"account_closure","message":""}`)

	if rec.Code != http.StatusConflict {
		t.Fatalf("closure with money = %d %s, want 409", rec.Code, rec.Body.String())
	}
	var got struct {
		Code     string           `json:"code"`
		Balances map[string]int64 `json:"balances"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Code != "balances_not_empty" || got.Balances["GBP"] != 1250 || got.Balances["USDC"] != 3_000_000 {
		t.Errorf("refusal = %s, want balances_not_empty with GBP 1250 and USDC 3000000", rec.Body.String())
	}
}

// The list is the workspace's requests as Lens keeps them, shown without the workspace's id or who filed each.
func TestWorkspaceRequestsListsTheWorkspacesRequests(t *testing.T) {
	var calls []string
	a := fakeLensRequests(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"requests":[`+lensFiledComplaint+`]}`)
	}, &calls)
	rec := doJSON(a, http.MethodGet, "/api/workspace/requests", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/workspace/requests = %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "filed_by") || strings.Contains(rec.Body.String(), "ws_x") {
		t.Errorf("list = %s, carries who filed or the workspace", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"reference":"C-ABCD-EFGH"`) {
		t.Errorf("list = %s, want the complaint's reference", rec.Body.String())
	}
}

// The data export downloads as a file once Lens has it ready; before then Lens's refusal is the answer.
func TestWorkspaceRequestExportDownloadsWhenReady(t *testing.T) {
	var calls []string
	ready := false
	a := fakeLensRequests(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		if r.URL.Path != "/v1/workspaces/"+deriveWorkspaceIDLikeLens(devIdentity)+"/requests/9/export" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if !ready {
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `{"error":"support: the export is not ready yet","code":"not_ready"}`)
			return
		}
		_, _ = io.WriteString(w, `{"tables":{}}`)
	}, &calls)

	if rec := doJSON(a, http.MethodGet, "/api/workspace/requests/9/export", ""); rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), "not ready") {
		t.Fatalf("export before it is ready = %d %s, want 409 with Lens's sentence", rec.Code, rec.Body.String())
	}
	ready = true
	rec := doJSON(a, http.MethodGet, "/api/workspace/requests/9/export", "")
	if rec.Code != http.StatusOK || rec.Body.String() != `{"tables":{}}` {
		t.Fatalf("export when ready = %d %s, want 200 and Lens's file", rec.Code, rec.Body.String())
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") {
		t.Errorf("Content-Disposition = %q, want an attachment", cd)
	}
}
