package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// lensCountryNotServed is talyvor-lens B61.53's refusal of a country Talyvor does not serve.
const lensCountryNotServed = `{"code":"country_not_served","error":"Talyvor is not available in that country yet.","field":"country"}`

// B61.110 — Lens's refusal of a country reaches the page with its code and field, through the identity check's relay
// and through sign-up's provisioning, so the page puts Lens's sentence on the country field.
func TestB61110_CountryNotServedReachesThePageWithItsCodeAndField(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, lensCountryNotServed)
	}))
	t.Cleanup(up.Close)
	a := &app{cfg: config{lensBaseURL: up.URL}, client: up.Client()}
	want := map[string]string{"code": "country_not_served", "error": "Talyvor is not available in that country yet.", "field": "country"}

	relayed := httptest.NewRecorder()
	a.lensRelay(relayed, httptest.NewRequest(http.MethodPost, "/api/verification/identity", nil), "tok", http.MethodPost, "/v1/workspaces/ws_1/verification/identity", []byte(`{}`), "/verification/identity")
	provisioned := httptest.NewRecorder()
	writeProvisionFailed(provisioned, provisionRefused{status: http.StatusBadRequest, msg: want["error"], code: want["code"], field: want["field"]})

	for name, rec := range map[string]*httptest.ResponseRecorder{"the identity check": relayed, "sign-up": provisioned} {
		var got map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
		if len(got) != len(want) || got["code"] != want["code"] || got["error"] != want["error"] || got["field"] != want["field"] {
			t.Errorf("%s answered %v, want %v", name, got, want)
		}
	}
}
