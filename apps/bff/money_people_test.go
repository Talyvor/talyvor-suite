package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B61.33 — find and pay a person reach Lens B61.32's routes under the session's token with only the fields the screen
// names: never funding, never a workspace; the Idempotency-Key header goes up beside the body's key, the challenge goes
// up without the signature, and Lens's words for nobody found and for a refusal reach the screen as they were said.
func TestPayAPersonReachesLensAsNamed(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || r.Header.Get("Authorization") == "Bearer " {
			t.Errorf("%s went up without the session's token", r.URL.Path)
		}
		got = append(got, r.Method+" "+r.URL.Path+" key="+r.Header.Get("Idempotency-Key")+" "+string(raw))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/money/people/find" && strings.Contains(string(raw), "nobody"):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"Nobody found. Check the name or number, or ask them to turn on being found in Settings.","reason":"not_found"}`))
		case r.URL.Path == "/v1/money/people/find":
			_, _ = w.Write([]byte(`{"shown_name":"Grace H."}`))
		case r.URL.Path == "/v1/money/people/pay/challenge":
			_, _ = w.Write([]byte(`{"challenge":"Y2g","allow_credentials":["c"],"user_verification":"required"}`))
		case strings.Contains(string(raw), `"currency":"EUR"`):
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"economy: the person paid has no account in this currency: Grace H. has no EUR account"}`))
		default:
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"me_1","to_shown_name":"Grace H.","amount_minor":1000,"currency":"GBP"}`))
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/people/find", `{"to":"grace.h","workspace_id":"ws_other"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"shown_name":"Grace H."`) {
		t.Fatalf("find = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/people/find", `{"to":"nobody"}`); rec.Code != http.StatusNotFound ||
		!strings.Contains(rec.Body.String(), "Nobody found. Check the name or number, or ask them to turn on being found in Settings.") {
		t.Fatalf("find nobody = %d %s, want 404 with Lens's words", rec.Code, rec.Body.String())
	}
	payment := `"to":"grace.h","amount_minor":1000,"currency":"GBP","account_id":"macc_1","note":"Lunch","idempotency_key":"k1"`
	if rec := postKeyed(a, "/api/money/people/pay/challenge", "k1", `{`+payment+`,"assertion":{"signature":"x"},"funding":"live"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"challenge":"Y2g"`) {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body.String())
	}
	if rec := postKeyed(a, "/api/money/people/pay", "k1", `{`+payment+`,"assertion":{"signature":"x"},"funding":"live","workspace_id":"ws_other"}`); rec.Code != http.StatusCreated {
		t.Fatalf("pay = %d %s", rec.Code, rec.Body.String())
	}
	if rec := postKeyed(a, "/api/money/people/pay", "k2", `{"to":"grace.h","amount_minor":1000,"currency":"EUR","idempotency_key":"k2"}`); rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), "Grace H. has no EUR account") {
		t.Fatalf("pay in a currency they do not hold = %d %s, want Lens's 409 and its words", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/people/pay", ""); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET pay = %d, want 405", rec.Code)
	}

	want := []string{
		`POST /v1/money/people/find key= {"to":"grace.h"}`,
		`POST /v1/money/people/find key= {"to":"nobody"}`,
		`POST /v1/money/people/pay/challenge key=k1 {` + payment + `}`,
		`POST /v1/money/people/pay key=k1 {` + payment + `,"assertion":{"signature":"x"}}`,
		`POST /v1/money/people/pay key=k2 {"to":"grace.h","amount_minor":1000,"currency":"EUR","account_id":"","note":"","idempotency_key":"k2"}`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens received\n  %s\nwant\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}
