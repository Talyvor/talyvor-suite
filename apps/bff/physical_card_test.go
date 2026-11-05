package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B53.12 — the physical card's order, activation and replacement reach Lens with only their own fields.
func TestPhysicalCardReachesLensWithOnlyItsFields(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.RequestURI()+" "+string(b))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	doJSON(a, http.MethodGet, "/api/money/physical-cards?workspace_id=ws_other", "")
	doJSON(a, http.MethodPost, "/api/money/physical-cards", `{"name_on_card":"A Owner","address":{"line1":"1 High St","line2":"","city":"London","postcode":"N1 9GU","country":"GB"},"wallet":"w_other"}`)
	doJSON(a, http.MethodPost, "/api/money/physical-cards/pc_1/activate", `{"last4":"4242","state":"active"}`)
	doJSON(a, http.MethodPost, "/api/money/physical-cards/pc_1/replace", `{"reason":"lost","address":{"line1":"elsewhere"}}`)
	want := []string{
		"GET /v1/money/physical-cards ",
		`POST /v1/money/physical-cards {"name_on_card":"A Owner","address":{"line1":"1 High St","line2":"","city":"London","postcode":"N1 9GU","country":"GB"}}`,
		`POST /v1/money/physical-cards/pc_1/activate {"last4":"4242"}`,
		`POST /v1/money/physical-cards/pc_1/replace {"reason":"lost"}`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens got\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/physical-cards/pc_1/activate", ""); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET activate = %d; want 405", rec.Code)
	}
}
