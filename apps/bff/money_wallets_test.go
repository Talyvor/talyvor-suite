package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newFakeLensWallets is a Lens that holds one company account, macc_mine, for the session's workspace: any other account
// is not found, as Lens answers for an account of another workspace. It records each call with its key and token.
func newFakeLensWallets(t *testing.T) (*app, *[]string) {
	t.Helper()
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" key="+r.Header.Get("Idempotency-Key")+" "+string(raw))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || r.Header.Get("Authorization") == "Bearer ":
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"no token"}`))
		case strings.HasPrefix(r.URL.Path, "/v1/money/accounts/") && !strings.HasPrefix(r.URL.Path, "/v1/money/accounts/macc_mine/"):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"economy: no account \"macc_theirs\" in this workspace"}`))
		case r.URL.Path == "/v1/money/convert/quote" && strings.Contains(string(raw), `"sell_currency":"EUR"`):
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"this workspace holds one kind of money","code":"wrong_money_kind","field":"convert","detail":"x"}`))
		case strings.HasSuffix(r.URL.Path, "/challenge"):
			_, _ = w.Write([]byte(`{"challenge":"Y2g","allow_credentials":["c"],"user_verification":"required"}`))
		default:
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"x_1","status":"completed"}`))
		}
	}))
	t.Cleanup(srv.Close)
	return newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil), &got
}

func postKeyed(a *app, path, key, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// B59.52 — Top up reaches Lens's Sandbox top up for the company account under the Idempotency-Key the screen sent, which
// Lens reads from the body; another workspace's account is Lens's 404, and nothing the browser names but the amount goes up.
func TestWalletTopUpReachesLens(t *testing.T) {
	a, got := newFakeLensWallets(t)
	if rec := postKeyed(a, "/api/money/accounts/macc_mine/top-up", "top-1", `{"amount_minor":5000,"funding":"live","workspace_id":"ws_other"}`); rec.Code != http.StatusCreated {
		t.Fatalf("top up = %d %s", rec.Code, rec.Body.String())
	}
	if rec := postKeyed(a, "/api/money/accounts/macc_theirs/top-up", "top-2", `{"amount_minor":5000}`); rec.Code != http.StatusNotFound {
		t.Fatalf("another workspace's account = %d %s, want 404", rec.Code, rec.Body.String())
	}
	want := []string{
		`POST /v1/money/accounts/macc_mine/test-money key=top-1 {"amount_minor":5000,"idempotency_key":"top-1"}`,
		`POST /v1/money/accounts/macc_theirs/test-money key=top-2 {"amount_minor":5000,"idempotency_key":"top-2"}`,
	}
	if strings.Join(*got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens received\n  %s\nwant\n  %s", strings.Join(*got, "\n  "), strings.Join(want, "\n  "))
	}
}

// B59.52 — Withdraw asks for its challenge and is sent with the signature exactly as the browser or the phone sent it,
// both under the screen's Idempotency-Key; another workspace's account is Lens's 404.
func TestWalletWithdrawReachesLensSigned(t *testing.T) {
	a, got := newFakeLensWallets(t)
	withdrawal := `"payee_id":"payee_own","amount_minor":2500`
	if rec := postKeyed(a, "/api/money/accounts/macc_mine/withdraw/challenge", "wd-1", `{`+withdrawal+`,"funding":"live","assertion":{"signature":"s"}}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"challenge":"Y2g"`) {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body.String())
	}
	phone := `{"device_id":"dev_1","challenge":"Y2g","signature":"MEUCIQ","user_handle":"u"}`
	if rec := postKeyed(a, "/api/money/accounts/macc_mine/withdraw", "wd-1", `{`+withdrawal+`,"assertion":`+phone+`}`); rec.Code != http.StatusCreated {
		t.Fatalf("withdraw = %d %s", rec.Code, rec.Body.String())
	}
	if rec := postKeyed(a, "/api/money/accounts/macc_theirs/withdraw", "wd-2", `{`+withdrawal+`,"assertion":`+phone+`}`); rec.Code != http.StatusNotFound {
		t.Fatalf("another workspace's account = %d %s, want 404", rec.Code, rec.Body.String())
	}
	want := []string{
		`POST /v1/money/accounts/macc_mine/withdraw/challenge key=wd-1 {` + withdrawal + `}`,
		`POST /v1/money/accounts/macc_mine/withdraw key=wd-1 {` + withdrawal + `,"assertion":` + phone + `}`,
		`POST /v1/money/accounts/macc_theirs/withdraw key=wd-2 {` + withdrawal + `,"assertion":` + phone + `}`,
	}
	if strings.Join(*got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens received\n  %s\nwant\n  %s", strings.Join(*got, "\n  "), strings.Join(want, "\n  "))
	}
}

// B59.52 — Convert is quoted, its challenge asked for and converted with the signature unchanged, under the screen's
// Idempotency-Key; outside Hybrid Lens's wrong_money_kind comes back with its code and field for the screen's words.
func TestWalletConvertReachesLensSigned(t *testing.T) {
	a, got := newFakeLensWallets(t)
	if rec := postKeyed(a, "/api/money/convert/quote", "", `{"sell_currency":"GBP","buy_currency":"USDC","sell_minor":10000,"funding":"live"}`); rec.Code != http.StatusCreated {
		t.Fatalf("quote = %d %s", rec.Code, rec.Body.String())
	}
	if rec := postKeyed(a, "/api/money/convert/challenge", "cv-1", `{"quote_id":"fxq_1","assertion":{"signature":"s"}}`); rec.Code != http.StatusOK {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body.String())
	}
	passkey := `{"credential_id":"c","client_data_json":"a","authenticator_data":"b","signature":"s"}`
	if rec := postKeyed(a, "/api/money/convert", "cv-1", `{"quote_id":"fxq_1","assertion":`+passkey+`}`); rec.Code != http.StatusCreated {
		t.Fatalf("convert = %d %s", rec.Code, rec.Body.String())
	}
	rec := postKeyed(a, "/api/money/convert/quote", "", `{"sell_currency":"EUR","buy_currency":"USDC","sell_minor":100}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"code":"wrong_money_kind"`) || !strings.Contains(rec.Body.String(), `"field":"convert"`) {
		t.Fatalf("outside Hybrid = %d %s, want 409 wrong_money_kind on convert", rec.Code, rec.Body.String())
	}
	want := []string{
		`POST /v1/money/convert/quote key= {"sell_currency":"GBP","buy_currency":"USDC","sell_minor":10000}`,
		`POST /v1/money/convert/challenge key=cv-1 {"quote_id":"fxq_1"}`,
		`POST /v1/money/convert key=cv-1 {"quote_id":"fxq_1","assertion":` + passkey + `}`,
		`POST /v1/money/convert/quote key= {"sell_currency":"EUR","buy_currency":"USDC","sell_minor":100}`,
	}
	if strings.Join(*got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens received\n  %s\nwant\n  %s", strings.Join(*got, "\n  "), strings.Join(want, "\n  "))
	}
}

// B59.52 — the bank Wallets withdraws to is saved as the owner's own: "own" reaches Lens's payee (Lens B59.51).
func TestOwnBankPayeeReachesLens(t *testing.T) {
	a, got := newFakeLensWallets(t)
	if rec := doJSON(a, http.MethodPost, "/api/money/payees", `{"name":"Me","country":"GB","sort_code":"040004","account_number":"12345678","own":true}`); rec.Code != http.StatusCreated {
		t.Fatalf("payee = %d %s", rec.Code, rec.Body.String())
	}
	if len(*got) != 1 || !strings.HasSuffix((*got)[0], `,"own":true}`) {
		t.Fatalf("Lens received %q; want the payee with \"own\":true", *got)
	}
}
