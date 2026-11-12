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
		{"account_type": {"personal"}, "money_kind": {"hybrid"}, "name": {"Maya\u202eLind"}},
		{"account_type": {"personal"}, "money_kind": {"hybrid"}, "name": {"Maya\nLind"}},
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

// A link on another site cannot choose the type and the kind for whoever signs up through it; a plain sign-in from
// anywhere still starts.
func TestB598_SignUpStartsOnlyFromThisSite(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	login := func(site, query string) int {
		req, _ := http.NewRequest(http.MethodGet, s.ts.URL+"/auth/login?"+query, nil)
		req.Header.Set("Sec-Fetch-Site", site)
		resp, err := s.browser().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	answers := url.Values{"account_type": {"personal"}, "money_kind": {"fiat"}, "name": {"Maya Lind"}}.Encode()
	for site, want := range map[string]int{"cross-site": 400, "same-site": 400, "same-origin": 302, "none": 302} {
		if got := login(site, answers); got != want {
			t.Errorf("sign-up with Sec-Fetch-Site %s: %d, want %d", site, got, want)
		}
	}
	if got := login("cross-site", "return_to=%2F"); got != 302 {
		t.Errorf("a sign-in from another site: %d, want 302", got)
	}
}

func (s *strangerSuite) profileOf(sub string) [2]string {
	ws := deriveWorkspaceIDLikeLens(provisionIdentity(s.idp.srv.URL, sub))
	s.lens.mu.Lock()
	defer s.lens.mu.Unlock()
	return s.lens.profiles[ws]
}

// B59.41: sign-up's country and a business's registration number reach Lens's POST /v1/provision with the other
// answers, from the web and from the phone, the country upper-case and both trimmed as Lens keeps them (B59.40).
func TestB5941_CountryAndRegistrationNumberReachLens(t *testing.T) {
	s := startStrangerSuiteWith(t, []string{"*"}, func(c *config) { c.oidcMobileClientIDs = []string{"phone-ios"} })
	for _, tc := range []struct {
		sub, typ, name, country, number string
		want                            [2]string
	}{
		{"b5941-personal", "personal", "Maya Lind", " gb ", "", [2]string{"GB", ""}},
		{"b5941-business", "business", "Northwind Studio", "DE", " HRB 12345 ", [2]string{"DE", "HRB 12345"}},
	} {
		cb, body := s.signUpAs(tc.sub, url.Values{"account_type": {tc.typ}, "money_kind": {"fiat"}, "name": {tc.name},
			"country": {tc.country}, "registration_number": {tc.number}})
		if cb.StatusCode != http.StatusFound {
			t.Fatalf("%s: callback %d (%s)", tc.typ, cb.StatusCode, body)
		}
		if got := s.profileOf(tc.sub); got != tc.want {
			t.Errorf("web %s: Lens was sent %q, want %q", tc.typ, got, tc.want)
		}
	}

	s.idp.sub, s.idp.email, s.idp.aud = "b5941-phone", "b5941-phone@example.org", "phone-ios"
	resp, err := s.ts.Client().Post(s.ts.URL+mobileSessionPath, "application/json", strings.NewReader(`{"id_token":"`+
		s.idp.mintIDToken("")+`","account_type":"business","money_kind":"hybrid","name":"Northwind Studio","country":"FR","registration_number":"552 100 554"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("phone sign-up: %d", resp.StatusCode)
	}
	if got, want := s.profileOf("b5941-phone"), [2]string{"FR", "552 100 554"}; got != want {
		t.Errorf("phone: Lens was sent %q, want %q", got, want)
	}
}

// A country that is not two letters, a registration number on a personal account, and one past Lens's 64 characters
// are refused before the identity provider, as the other answers are.
func TestB5941_ABadProfileIsRefusedBeforeTheIdentityProvider(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	business := func(country, number string) url.Values {
		return url.Values{"account_type": {"business"}, "money_kind": {"fiat"}, "name": {"Northwind Studio"},
			"country": {country}, "registration_number": {number}}
	}
	for _, q := range []url.Values{
		business("GBR", "123"),
		business("G1", "123"),
		business("GB", strings.Repeat("1", 65)),
		business("GB", "12\n34"),
		{"account_type": {"personal"}, "money_kind": {"fiat"}, "name": {"Maya Lind"}, "country": {"GB"}, "registration_number": {"123"}},
		{"country": {"GB"}},
	} {
		resp, body := s.signUpAs("b5941-refused", q)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%v: got %d (%s), want 400", q, resp.StatusCode, body)
		}
	}
	if _, ok := s.accountOf("b5941-refused"); ok {
		t.Fatal("a refused sign-up made a workspace")
	}
}
