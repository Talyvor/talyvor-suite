package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeLensCardDisputes records each call Lens gets, and answers the card export as Lens does: CSV with its filename.
func fakeLensCardDisputes(t *testing.T, got *[]string) *app {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		*got = append(*got, r.Method+" "+r.URL.RequestURI()+" "+string(b))
		if r.URL.Path == "/v1/money/card-exports" {
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename="card-payments-2026-11-01-2026-11-12.csv"`)
			_, _ = io.WriteString(w, "type,at,id\npayment,2026-11-02T10:00:00Z,iauth_1\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusCreated)
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	return newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)
}

// B59.25 — a dispute reaches Lens with the payment and the reason only; the list of disputes and of refunds are Lens's.
func TestCardDisputeReachesLensWithOnlyThePaymentAndTheReason(t *testing.T) {
	var got []string
	a := fakeLensCardDisputes(t, &got)
	if rec := doJSON(a, http.MethodPost, "/api/money/card-disputes", `{"payment_id":"iauth_1","reason":"Charged twice","status":"won","workspace_id":"ws_other"}`); rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/money/card-disputes = %d %s", rec.Code, rec.Body.String())
	}
	doJSON(a, http.MethodGet, "/api/money/card-disputes", "")
	doJSON(a, http.MethodGet, "/api/money/card-refunds", "")
	want := []string{
		`POST /v1/money/card-disputes {"payment_id":"iauth_1","reason":"Charged twice"}`,
		"GET /v1/money/card-disputes ",
		"GET /v1/money/card-refunds ",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens got\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/card-refunds", `{"payment_id":"iauth_1","amount_minor":1000}`); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/money/card-refunds = %d; want 405: a refund is the issuer's, not the owner's", rec.Code)
	}
}

// B59.25 — the export asks Lens for the range and comes back as Lens's CSV, with its filename, to save as a file.
func TestCardExportIsLensCSVForTheRange(t *testing.T) {
	var got []string
	a := fakeLensCardDisputes(t, &got)
	rec := doJSON(a, http.MethodGet, "/api/money/card-exports?from=2026-11-01&to=2026-11-12&workspace_id=ws_other", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/money/card-exports = %d %s", rec.Code, rec.Body.String())
	}
	if want := "GET /v1/money/card-exports?format=csv&from=2026-11-01&to=2026-11-12 "; len(got) != 1 || got[0] != want {
		t.Fatalf("Lens got %q, want %q", got, want)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Errorf("Content-Type = %q, want text/csv", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "card-payments-2026-11-01-2026-11-12.csv") {
		t.Errorf("Content-Disposition = %q, want Lens's filename", cd)
	}
	if !strings.HasPrefix(rec.Body.String(), "type,at,id\npayment,") {
		t.Errorf("body = %q, want Lens's CSV", rec.Body.String())
	}
}
