package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const lensBusinessDetails = `{"workspace_id":"ws_x","company_name":"Northwind Studio Ltd","registration_number":"12345678",` +
	`"country":"GB","people":[{"name":"Ada Lovelace","role":"director","share_bps":6000}],"updated_by":"jwt:user:u_1",` +
	`"updated_at":"2026-11-12T09:00:00Z"}`

// fakeLensBusiness answers Lens B59.30's business route for the dev session's own workspace and token only, with
// serve; any other workspace or credential gets Lens's 404. It records each call with the body Lens was sent.
func fakeLensBusiness(t *testing.T, serve func(w http.ResponseWriter, r *http.Request), calls *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		*calls = append(*calls, r.Method+" "+strings.TrimPrefix(r.URL.Path, "/v1/workspaces/"+own)+" "+string(raw))
		if r.URL.Path != "/v1/workspaces/"+own+"/business" || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
			http.NotFound(w, r)
			return
		}
		serve(w, r)
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

// B59.31 — the owner reads the company details of the session's own workspace, whatever workspace the request names,
// without Lens's workspace id or who saved them last.
func TestWorkspaceBusinessReadsTheSessionsOwnDetails(t *testing.T) {
	var calls []string
	a := fakeLensBusiness(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, lensBusinessDetails)
	}, &calls)
	rec := doJSON(a, http.MethodGet, "/api/workspace/business?workspace_id=SOMEBODY-ELSE", "")

	want := `{"company_name":"Northwind Studio Ltd","registration_number":"12345678","country":"GB","people":[{"name":"Ada Lovelace","role":"director","share_bps":6000}]}` + "\n"
	if rec.Code != http.StatusOK || rec.Body.String() != want {
		t.Fatalf("GET /api/workspace/business = %d %q, want 200 %q", rec.Code, rec.Body.String(), want)
	}
	if len(calls) != 1 || calls[0] != "GET /business " {
		t.Errorf("Lens was asked %q, want only the session's own GET /business", calls)
	}
}

// B59.31 — what is sent: the company's name, number and country and each person's name, role and share, and nothing
// else the browser added.
func TestWorkspaceBusinessSendsOnlyTheDetails(t *testing.T) {
	var calls []string
	a := fakeLensBusiness(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, lensBusinessDetails)
	}, &calls)
	rec := doJSON(a, http.MethodPut, "/api/workspace/business",
		`{"company_name":"Northwind Studio Ltd","registration_number":"12345678","country":"GB","workspace_id":"SOMEBODY-ELSE",`+
			`"people":[{"name":"Ada Lovelace","role":"director","share_bps":6000,"passport":"x"}],"updated_by":"x"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /api/workspace/business = %d %s", rec.Code, rec.Body.String())
	}
	want := `PUT /business {"company_name":"Northwind Studio Ltd","country":"GB",` +
		`"people":[{"name":"Ada Lovelace","role":"director","share_bps":6000}],"registration_number":"12345678"}`
	if len(calls) != 1 || calls[0] != want {
		t.Errorf("Lens was sent %q, want %q", calls, want)
	}
}

// B59.31 — a Personal workspace has no company details: Lens's not_business is passed on, and so is Lens's sentence
// for details it refused.
func TestWorkspaceBusinessPassesOnNotBusinessAndRefusals(t *testing.T) {
	var calls []string
	a := fakeLensBusiness(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":"economy: a Personal workspace has no business details","code":"not_business"}`)
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":"economy: invalid business details: the company's registration number is 1 to 64 characters"}`)
	}, &calls)

	rec := doJSON(a, http.MethodGet, "/api/workspace/business", "")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"not_business"`) {
		t.Errorf("GET for a Personal workspace = %d %s, want 404 not_business", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPut, "/api/workspace/business", `{"company_name":"a","country":"GB"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "registration number is 1 to 64 characters") {
		t.Errorf("PUT refused by Lens = %d %s, want 400 with Lens's sentence", rec.Code, rec.Body.String())
	}
}
