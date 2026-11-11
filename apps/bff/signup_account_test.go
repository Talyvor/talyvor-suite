package main

// signup_account_test.go — B59.8: sign-up asks who the account is for and the kind of money, and both reach Lens's
// POST /v1/provision on the call that makes the workspace. Driven from an empty cookie jar through the real login,
// IdP and callback, so what is asserted is what Lens was sent.

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// signUpAs drives /auth/login with the sign-up's answers through to the callback, as a stranger's browser would.
func (s *strangerSuite) signUpAs(sub string, answers url.Values) (*http.Response, string) {
	s.t.Helper()
	s.idp.sub, s.idp.email = sub, sub+"@example.org"
	br := s.browser()
	answers.Set("return_to", "/signup/key")
	login, body := doReq(s.t, br, http.MethodGet, s.ts.URL+"/auth/login?"+answers.Encode())
	if login.StatusCode != http.StatusFound {
		return login, body
	}
	idp, idpBody := doReq(s.t, br, http.MethodGet, login.Header.Get("Location"))
	if idp.StatusCode != http.StatusFound {
		s.t.Fatalf("idp authorize: got %d (%s)", idp.StatusCode, idpBody)
	}
	return doReq(s.t, br, http.MethodGet, idp.Header.Get("Location"))
}

func (s *strangerSuite) accountOf(sub string) ([3]string, bool) {
	ws := deriveWorkspaceIDLikeLens(provisionIdentity(s.idp.srv.URL, sub))
	s.lens.mu.Lock()
	defer s.lens.mu.Unlock()
	a, ok := s.lens.accounts[ws]
	return a, ok
}

func TestB598_EachOfTheSixChoicesReachesLensAsItsTypeAndKind(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	for _, typ := range []string{"personal", "business"} {
		for _, kind := range []string{"fiat", "stablecoin", "hybrid"} {
			sub := "b598-" + typ + "-" + kind
			name := "Maya Lind"
			if typ == "business" {
				name = "Northwind Studio"
			}
			cb, body := s.signUpAs(sub, url.Values{"account_type": {typ}, "money_kind": {kind}, "name": {"  " + name + " "}})
			if cb.StatusCode != http.StatusFound || cb.Header.Get("Location") != "/signup/key" {
				t.Fatalf("%s %s: callback %d to %q (%s), want 302 to step 3", typ, kind, cb.StatusCode, cb.Header.Get("Location"), body)
			}
			got, ok := s.accountOf(sub)
			if !ok {
				t.Fatalf("%s %s: no workspace was made at Lens", typ, kind)
			}
			if want := [3]string{typ, kind, name}; got != want {
				t.Errorf("Lens was sent %q, want %q", got, want)
			}
		}
	}
}

// Signing in sends neither, so a returning person's workspace keeps what it was made as (Lens sets them only on the
// call that makes it) and a workspace made before sign-up asked is Lens's default.
func TestB598_SigningInSendsNoTypeOrKind(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	s.signUp("b598-signin", "b598-signin@example.org")
	got, ok := s.accountOf("b598-signin")
	if !ok || got != ([3]string{}) {
		t.Fatalf("a sign-in sent %q (made: %v), want nothing", got, ok)
	}
}

func TestB598_SignUpCannotStartWithoutBoth(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	for _, q := range []url.Values{
		{"account_type": {"personal"}, "name": {"Maya Lind"}},
		{"money_kind": {"fiat"}, "name": {"Maya Lind"}},
		{"account_type": {"personal"}, "money_kind": {""}, "name": {"Maya Lind"}},
		{"account_type": {"family"}, "money_kind": {"fiat"}, "name": {"Maya Lind"}},
		{"account_type": {"business"}, "money_kind": {"gold"}, "name": {"Northwind Studio"}},
		{"account_type": {"personal"}, "money_kind": {"hybrid"}},
		{"account_type": {"personal"}, "money_kind": {"hybrid"}, "name": {strings.Repeat("n", 81)}},
	} {
		resp, body := s.signUpAs("b598-refused", q)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%v: got %d (%s), want 400 before the identity provider", q, resp.StatusCode, body)
		}
		if c := cookieNamed(resp, pendingCookieName); c != nil {
			t.Errorf("%v: a refused sign-up still started a login", q)
		}
	}
	if _, ok := s.accountOf("b598-refused"); ok {
		t.Fatal("a refused sign-up made a workspace")
	}
}

// The phone (B59.9) sends the same three answers with its ID token.
func TestB598_ThePhoneSendsTheSameAnswers(t *testing.T) {
	s := startStrangerSuiteWith(t, []string{"*"}, func(c *config) { c.oidcMobileClientIDs = []string{"phone-ios"} })
	s.idp.sub, s.idp.email, s.idp.aud = "b598-phone", "b598-phone@example.org", "phone-ios"
	post := func(body string) (int, string) {
		resp, err := s.ts.Client().Post(s.ts.URL+mobileSessionPath, "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if code, body := post(`{"id_token":"` + s.idp.mintIDToken("") + `","account_type":"personal"}`); code != http.StatusBadRequest {
		t.Fatalf("the type without the kind: %d (%s), want 400", code, body)
	}
	if _, ok := s.accountOf("b598-phone"); ok {
		t.Fatal("a refused phone sign-up made a workspace")
	}
	if code, body := post(`{"id_token":"` + s.idp.mintIDToken("") + `","account_type":"business","money_kind":"stablecoin","name":"Northwind Studio"}`); code != http.StatusOK {
		t.Fatalf("phone sign-up: %d (%s)", code, body)
	}
	if got, want := func() [3]string { a, _ := s.accountOf("b598-phone"); return a }(), [3]string{"business", "stablecoin", "Northwind Studio"}; got != want {
		t.Errorf("Lens was sent %q, want %q", got, want)
	}
}
