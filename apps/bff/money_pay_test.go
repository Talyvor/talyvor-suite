package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B30.96 — a payee and a payment reach Lens under the session's token with only the fields the screen names; a payout
// batch goes up as the CSV it came as, under the browser's Idempotency-Key.
func TestPayScreenWritesReachLensAsNamed(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" ct="+r.Header.Get("Content-Type")+" key="+r.Header.Get("Idempotency-Key")+" auth="+r.Header.Get("Authorization")+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"x_1","status":"ok"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/payees", `{"name":"Acme","country":"GB","sort_code":"040004","account_number":"12345678","check":"exact_match","workspace_id":"other"}`); rec.Code != http.StatusCreated {
		t.Fatalf("payee = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/payments", `{"account_id":"macc_1","payee_id":"payee_1","amount_minor":2000,"currency":"GBP","reference":"Rent","idempotency_key":"k1","funding":"live","status":"completed"}`); rec.Code != http.StatusCreated {
		t.Fatalf("payment = %d %s", rec.Code, rec.Body.String())
	}
	csv := "payee_id,amount,currency,reference\npayee_1,5.00,GBP,May\n"
	up := httptest.NewRequest(http.MethodPost, "/api/money/payouts", strings.NewReader(csv))
	up.Header.Set("Content-Type", "text/csv")
	up.Header.Set("Idempotency-Key", "batch-1")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, up)
	if rec.Code != http.StatusCreated {
		t.Fatalf("csv upload = %d %s", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 3 {
		t.Fatalf("Lens saw %d calls, want 3:\n  %s", len(got), strings.Join(got, "\n  "))
	}
	for i, call := range got {
		if !strings.Contains(call, " auth=Bearer ") || strings.Contains(call, "auth=Bearer  ") {
			t.Errorf("call %d did not go up under the session's token: %s", i, call)
		}
	}
	payee := got[0][strings.Index(got[0], " {"):]
	for _, key := range []string{`"name":"Acme"`, `"country":"GB"`, `"sort_code":"040004"`, `"account_number":"12345678"`} {
		if !strings.Contains(payee, key) {
			t.Errorf("the payee sent to Lens lacks %s: %s", key, payee)
		}
	}
	for _, key := range []string{`"check"`, `"workspace_id"`} {
		if strings.Contains(payee, key) {
			t.Errorf("the payee sent to Lens carries %s, which the handler does not name: %s", key, payee)
		}
	}
	payment := got[1][strings.Index(got[1], " {"):]
	for _, key := range []string{`"account_id":"macc_1"`, `"payee_id":"payee_1"`, `"amount_minor":2000`, `"currency":"GBP"`, `"reference":"Rent"`, `"idempotency_key":"k1"`} {
		if !strings.Contains(payment, key) {
			t.Errorf("the payment sent to Lens lacks %s: %s", key, payment)
		}
	}
	for _, key := range []string{`"funding"`, `"status"`} {
		if strings.Contains(payment, key) {
			t.Errorf("the payment sent to Lens carries %s, which the handler does not name: %s", key, payment)
		}
	}
	if want := "POST /v1/money/payouts ct=text/csv key=batch-1 auth=Bearer "; !strings.HasPrefix(got[2], want) || !strings.HasSuffix(got[2], " "+csv) {
		t.Errorf("the payout batch did not go up as the CSV it came as, under its key: %q", got[2])
	}
}

// B41.11 — the "I called them" confirmation reaches Lens on the payee's called route, its assertion rebuilt to
// {"assertion"} alone, and the challenge it is signed over is relayed.
func TestPayeeCalledReachesLens(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" "+string(raw))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"payee_1"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/payees/payee_1/called/challenge", `{}`); rec.Code != http.StatusOK {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/payees/payee_1/called", `{}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("unsigned = %d %s, want 400 before Lens", rec.Code, rec.Body.String())
	}
	signed := `{"assertion":{"credential_id":"c","client_data_json":"a","authenticator_data":"b","signature":"s"},"called_at":"2026-01-01T00:00:00Z"}`
	if rec := doJSON(a, http.MethodPost, "/api/money/payees/payee_1/called", signed); rec.Code != http.StatusOK {
		t.Fatalf("signed = %d %s", rec.Code, rec.Body.String())
	}
	want := []string{
		"POST /v1/money/payees/payee_1/called/challenge ",
		`POST /v1/money/payees/payee_1/called {"assertion":{"credential_id":"c","client_data_json":"a","authenticator_data":"b","signature":"s"}}`,
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("Lens received %q, want %q", got, want)
	}
}

// B41.12 — changing a payee's bank details reaches Lens on its details route: the challenge with the new details alone,
// the change with them and the assertion; a change with no assertion is refused before Lens.
func TestPayeeDetailsChangeReachesLens(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" "+string(raw))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"payee_1"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	details := `{"sort_code":"400000","account_number":"12345678"`
	if rec := doJSON(a, http.MethodPost, "/api/money/payees/payee_1/details/challenge", details+`,"assertion":{"credential_id":"c"}}`); rec.Code != http.StatusOK {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/payees/payee_1/details", details+`}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("unsigned = %d %s, want 400 before Lens", rec.Code, rec.Body.String())
	}
	signed := details + `,"name":"Mallory","assertion":{"credential_id":"c","client_data_json":"a","authenticator_data":"b","signature":"s"}}`
	if rec := doJSON(a, http.MethodPost, "/api/money/payees/payee_1/details", signed); rec.Code != http.StatusOK {
		t.Fatalf("signed = %d %s", rec.Code, rec.Body.String())
	}
	sent := `"country":"","sort_code":"400000","account_number":"12345678","iban":"","bic":"","routing_number":"","network":"","address":""`
	want := []string{
		"POST /v1/money/payees/payee_1/details/challenge {" + sent + "}",
		"POST /v1/money/payees/payee_1/details {" + sent + `,"assertion":{"credential_id":"c","client_data_json":"a","authenticator_data":"b","signature":"s"}}`,
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("Lens received %q, want %q", got, want)
	}
}

// B54.35 — a person's payment goes up with its signature exactly as the browser or the phone sent it (Lens B54.33), and
// the challenge it is signed over is asked for with the payment as it will be sent: the same six fields, nothing more.
func TestPaymentSignatureReachesLensUnchanged(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" "+string(raw))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"challenge":"Y2g","allow_credentials":[]}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	payment := `"account_id":"macc_1","payee_id":"payee_1","amount_minor":2000,"currency":"GBP","reference":"Rent","idempotency_key":"k1"`
	if rec := doJSON(a, http.MethodPost, "/api/money/payments/challenge", `{`+payment+`,"funding":"live","assertion":{"signature":"s"}}`); rec.Code != http.StatusOK {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body.String())
	}
	passkey := `{"credential_id":"c","client_data_json":"a","authenticator_data":"b","signature":"s"}`
	phone := `{"device_id":"dev_1","challenge":"Y2g","signature":"MEUCIQ","user_handle":"u"}`
	for _, assertion := range []string{passkey, phone} {
		if rec := doJSON(a, http.MethodPost, "/api/money/payments", `{`+payment+`,"assertion":`+assertion+`}`); rec.Code != http.StatusOK {
			t.Fatalf("signed payment = %d %s", rec.Code, rec.Body.String())
		}
	}
	want := []string{
		`POST /v1/money/payments/challenge {` + payment + `}`,
		`POST /v1/money/payments {` + payment + `,"assertion":` + passkey + `}`,
		`POST /v1/money/payments {` + payment + `,"assertion":` + phone + `}`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens received\n  %s\nwant\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// B58.6 — approving a payout batch goes up with its signature exactly as the browser or the phone sent it (Lens B58.5),
// and the challenge it is signed over, naming the batch as it stands, is relayed with no body of the browser's.
func TestPayoutApprovalSignatureReachesLensUnchanged(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" "+string(raw))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"challenge":"Y2g","allow_credentials":["c"],"payout":{"id":"pob_1","rows_total":2,"rows_valid":2,"totals_minor":{"GBP":700}}}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/payouts/pob_1/approve/challenge", `{"rows_valid":1}`); rec.Code != http.StatusOK {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body.String())
	}
	passkey := `{"credential_id":"c","client_data_json":"a","authenticator_data":"b","signature":"s"}`
	phone := `{"device_id":"dev_1","challenge":"Y2g","signature":"MEUCIQ","user_handle":"u"}`
	for _, assertion := range []string{passkey, phone} {
		if rec := doJSON(a, http.MethodPost, "/api/money/payouts/pob_1/approve", `{"assertion":`+assertion+`,"by":"someone"}`); rec.Code != http.StatusOK {
			t.Fatalf("signed approval = %d %s", rec.Code, rec.Body.String())
		}
	}
	want := []string{
		`POST /v1/money/payouts/pob_1/approve/challenge `,
		`POST /v1/money/payouts/pob_1/approve {"assertion":` + passkey + `}`,
		`POST /v1/money/payouts/pob_1/approve {"assertion":` + phone + `}`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens received\n  %s\nwant\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// B55.56 — the owner's mandate grant goes up beside its signature (Lens B55.24), the challenge it is signed over is asked
// for with the grant as it will be sent, and an agent's requested mandate is approved signed or declined, field by field.
// Without a key the workspace approves unsigned, and Lens decides whether it may.
func TestMandateGrantAndDecisionReachLensSigned(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.RequestURI()+" "+string(raw))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"challenge":"Y2g","allow_credentials":[]}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	grant := `{"account_id":"macc_1","payee_workspace_id":"","payee_business_id":"biz_1","payee_id":"payee_1","payee_name":"Kite","max_per_pull_minor":500,"max_per_month_minor":2000,"expires_at":"2027-11-10T23:59:59Z"}`
	passkey := `{"credential_id":"c","client_data_json":"a","authenticator_data":"b","signature":"s"}`
	phone := `{"device_id":"dev_1","challenge":"Y2g","signature":"MEUCIQ","user_handle":"u"}`
	for _, c := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/money/mandates/challenge", `{"grant":` + grant + `,"assertion":` + passkey + `,"extra":1}`},
		{http.MethodPost, "/api/money/mandates/challenge", `{"mandate_id":"mdt_1"}`},
		{http.MethodPost, "/api/money/mandates", `{"grant":` + grant + `,"assertion":` + passkey + `}`},
		{http.MethodPost, "/api/money/mandates/mdt_1/approve", `{"assertion":` + phone + `}`},
		{http.MethodPost, "/api/money/mandates/mdt_3/approve", `{}`},
		{http.MethodPost, "/api/money/mandates/mdt_2/decline", `{"assertion":` + passkey + `}`},
		{http.MethodGet, "/api/money/mandates?status=requested", ``},
	} {
		if rec := doJSON(a, c.method, c.path, c.body); rec.Code != http.StatusOK {
			t.Fatalf("%s %s = %d %s", c.method, c.path, rec.Code, rec.Body.String())
		}
	}
	want := []string{
		`POST /v1/money/mandates/challenge {"grant":` + grant + `}`,
		`POST /v1/money/mandates/challenge {"mandate_id":"mdt_1"}`,
		`POST /v1/money/mandates {"grant":` + grant + `,"assertion":` + passkey + `}`,
		`POST /v1/money/mandates/mdt_1/approve {"assertion":` + phone + `}`,
		`POST /v1/money/mandates/mdt_3/approve {}`,
		`POST /v1/money/mandates/mdt_2/decline `,
		`GET /v1/money/mandates?status=requested `,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens received\n  %s\nwant\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
	// A grant with no grant, or a status Lens does not have, never leaves the BFF.
	got = nil
	for _, c := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/money/mandates", `{"assertion":` + passkey + `}`},
		{http.MethodGet, "/api/money/mandates?status=anything", ``},
	} {
		if rec := doJSON(a, c.method, c.path, c.body); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s %s %s = %d, want 400", c.method, c.path, c.body, rec.Code)
		}
	}
	if len(got) != 0 {
		t.Fatalf("Lens received %q, want nothing", got)
	}
}
