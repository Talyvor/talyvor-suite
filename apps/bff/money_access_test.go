package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// B41.15 — the Keys page reads what may act for the workspace and revokes a mandate through the BFF, on the session's
// token, against a fake Lens.
func TestMoneyAccessListsAndRevokesAMandateThroughBFF(t *testing.T) {
	revoked := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		status := "active"
		if revoked {
			status = "revoked"
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /v1/money/access":
			_, _ = w.Write([]byte(`{"items":[{"kind":"mandate","id":"pm_1","name":"claude","status":"` + status +
				`","revoke":"/v1/money/permission-mandates/pm_1/revoke"}]}`))
		case "POST /v1/money/permission-mandates/pm_1/revoke":
			revoked = true
			_, _ = w.Write([]byte(`{"id":"pm_1","status":"revoked"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodGet, "/api/money/access", ``); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"active"`) {
		t.Fatalf("access = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/permission-mandates/pm_1/revoke", ``); rec.Code != http.StatusOK {
		t.Fatalf("revoke = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/access", ``); !strings.Contains(rec.Body.String(), `"status":"revoked"`) {
		t.Fatalf("after revoke the list reads %s", rec.Body.String())
	}
}

// B55.42 — Lens names a mandate by its clients joined, "mcp:<client id>"; Keys shows the assistant's own name, and a
// mandate whose assistant is not known here reads as a permission the person signed.
func TestMoneyAccessNamesAMandateByItsAssistant(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"kind":"mandate","id":"pm_1","name":"mcp:tlv_oc_claude","status":"active"},` +
			`{"kind":"mandate","id":"pm_2","name":"mcp:tlv_oc_gone","status":"active"},{"kind":"device","id":"dk_1","name":"Ada's phone","status":"active"}]}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)
	a.oauth.grants.put("g-1", oauthGrant{ID: "g-1", ClientID: "tlv_oc_claude", ClientName: "Claude", expires: time.Now().Add(time.Hour)})

	rec := doJSON(a, http.MethodGet, "/api/money/access", ``)
	var got struct {
		Items []struct{ ID, Name, Status string } `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); rec.Code != http.StatusOK || err != nil || len(got.Items) != 3 {
		t.Fatalf("access = %d %s", rec.Code, rec.Body.String())
	}
	if got.Items[0].Name != "Claude" || got.Items[1].Name != "A permission you signed" || got.Items[2].Name != "Ada's phone" || got.Items[0].Status != "active" {
		t.Fatalf("names = %+v", got.Items)
	}
}
