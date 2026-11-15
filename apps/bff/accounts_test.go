package main

// accounts_test.go — B61.8: a person's accounts, switching between them, and opening another, through the real
// login, IdP and callback against a Lens stand-in that answers B61.7's provision modes (stranger_signup_test.go).
// "Reaches the account" is read from Lens's side: GET /api/workspace/account answers only on that account's own token.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// signUpIn drives sign-up's answers through /auth/login to the callback in br, which may already be signed in.
func (s *strangerSuite) signUpIn(br *http.Client, sub string, answers url.Values) {
	s.t.Helper()
	s.idp.sub, s.idp.email = sub, sub+"@example.org"
	login, body := doReq(s.t, br, http.MethodGet, s.ts.URL+"/auth/login?"+answers.Encode())
	if login.StatusCode != http.StatusFound {
		s.t.Fatalf("login: %d (%s)", login.StatusCode, body)
	}
	idp, idpBody := doReq(s.t, br, http.MethodGet, login.Header.Get("Location"))
	if idp.StatusCode != http.StatusFound {
		s.t.Fatalf("idp authorize: %d (%s)", idp.StatusCode, idpBody)
	}
	if cb, cbBody := doReq(s.t, br, http.MethodGet, idp.Header.Get("Location")); cb.StatusCode != http.StatusFound {
		s.t.Fatalf("callback: %d (%s)", cb.StatusCode, cbBody)
	}
}

var (
	b618Business = url.Values{"account_type": {"business"}, "money_kind": {"hybrid"}, "name": {"Northwind Studio"}}
	b618Personal = url.Values{"account_type": {"personal"}, "money_kind": {"fiat"}, "name": {"Maya Lind"}}
)

// accountTypeOf is the type of the account br's session reaches, read from Lens.
func (s *strangerSuite) accountTypeOf(br *http.Client) string {
	s.t.Helper()
	resp, body := doReq(s.t, br, http.MethodGet, s.ts.URL+"/api/workspace/account")
	if resp.StatusCode != http.StatusOK {
		s.t.Fatalf("/api/workspace/account: %d (%s)", resp.StatusCode, body)
	}
	var got struct {
		WorkspaceID string `json:"workspace_id"`
		AccountType string `json:"account_type"`
	}
	_ = json.Unmarshal([]byte(body), &got)
	return got.AccountType + " " + got.WorkspaceID
}

func (s *strangerSuite) accountsOf(br *http.Client) []personAccount {
	s.t.Helper()
	resp, body := doReq(s.t, br, http.MethodGet, s.ts.URL+"/api/accounts")
	if resp.StatusCode != http.StatusOK {
		s.t.Fatalf("/api/accounts: %d (%s)", resp.StatusCode, body)
	}
	var got struct {
		Accounts []personAccount `json:"accounts"`
	}
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		s.t.Fatalf("/api/accounts unreadable: %v (%s)", err, body)
	}
	return got.Accounts
}

func b618Moved(t *testing.T, code int, body string) string {
	t.Helper()
	var out struct {
		AccountID string `json:"account_id"`
	}
	if code != http.StatusOK || json.Unmarshal([]byte(body), &out) != nil || out.AccountID == "" {
		t.Fatalf("got %d (%s), want 200 naming the account", code, body)
	}
	return out.AccountID
}

const b618PersonalJSON = `{"type":"personal","kind":"fiat","name":"Maya Lind"}`

// openPersonal opens a Personal account from br's session and answers its id.
func (s *strangerSuite) openPersonal(br *http.Client) string {
	s.t.Helper()
	code, body := s.post(br, "/api/accounts", b618PersonalJSON)
	return b618Moved(s.t, code, body)
}

func TestB618_OpenAnotherAccountThenSwitchBack(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	br := s.browser()
	s.signUpIn(br, "b618-maya", b618Business)
	first := deriveWorkspaceIDLikeLens(provisionIdentity(s.idp.srv.URL, "b618-maya"))
	if got := s.accountTypeOf(br); got != "business "+first {
		t.Fatalf("after sign-up the session reaches %q, want the business account %s", got, first)
	}

	second := s.openPersonal(br)
	if second == first {
		t.Fatalf("opening another account answered the first, %s", first)
	}
	if got := s.accountTypeOf(br); got != "personal "+second {
		t.Fatalf("after opening a Personal account the session reaches %q, want %s", got, second)
	}
	list := s.accountsOf(br)
	if len(list) != 2 || list[0].ID != first || list[0].Current || list[1].ID != second || !list[1].Current ||
		list[1].Type != "personal" || list[1].Kind != "fiat" || list[1].Name != "Maya Lind" {
		t.Fatalf("/api/accounts = %+v, want the business account then the current personal one", list)
	}

	// A restart restores the session from its seal on the account it moved to, not the one it was made on.
	u, _ := url.Parse(s.ts.URL)
	restartedAuth, err := newAuthenticator(t.Context(), s.app.cfg)
	if err != nil {
		t.Fatal(err)
	}
	restarted := newApp(s.app.cfg, restartedAuth)
	req := httptest.NewRequest(http.MethodGet, "/api/workspace/account", nil)
	for _, c := range br.Jar.Cookies(u) {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	restarted.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"workspace_id":"`+second+`"`) {
		t.Fatalf("after a restart the session reaches %d %s, want %s", rec.Code, rec.Body.String(), second)
	}

	code, body := s.post(br, "/api/accounts/switch", `{"account_id":"`+first+`"}`)
	if got := b618Moved(t, code, body); got != first {
		t.Fatalf("switching back answered %s, want %s", got, first)
	}
	if got := s.accountTypeOf(br); got != "business "+first {
		t.Fatalf("after switching back the session reaches %q, want %s", got, first)
	}
}

func TestB618_SwitchingToAnotherPersonsAccountOrFromAnotherSiteIsRefused(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	maya, bob := s.browser(), s.browser()
	s.signUpIn(maya, "b618-maya", b618Business)
	s.signUpIn(bob, "b618-bob", b618Business)
	mayaFirst := deriveWorkspaceIDLikeLens(provisionIdentity(s.idp.srv.URL, "b618-maya"))
	mayaSecond := s.openPersonal(maya)
	bobAt := s.accountTypeOf(bob)

	for _, id := range []string{mayaFirst, mayaSecond, "a-made-up-account"} {
		if code, body := s.post(bob, "/api/accounts/switch", `{"account_id":"`+id+`"}`); code != http.StatusNotFound {
			t.Errorf("Bob switching to %s: %d (%s), want 404", id, code, body)
		}
		if got := s.accountTypeOf(bob); got != bobAt {
			t.Fatalf("a refused switch moved Bob's session to %q", got)
		}
	}

	for path, body := range map[string]string{"/api/accounts/switch": `{"account_id":"` + mayaFirst + `"}`, "/api/accounts": b618PersonalJSON} {
		req, _ := http.NewRequest(http.MethodPost, s.ts.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://evil.example")
		req.Header.Set("Sec-Fetch-Site", "cross-site")
		resp, err := maya.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("a cross-site POST %s: %d, want 403", path, resp.StatusCode)
		}
		if got := s.accountTypeOf(maya); got != "personal "+mayaSecond {
			t.Fatalf("a cross-site POST %s moved Maya's session to %q", path, got)
		}
	}
	if list := s.accountsOf(maya); len(list) != 2 {
		t.Fatalf("a cross-site open made an account: %+v", list)
	}
}

// The eleventh account is Lens's refusal, in Lens's words, and the session stays where it was.
func TestB618_TheEleventhAccountIsRefusedInWords(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	br := s.browser()
	s.signUpIn(br, "b618-many", b618Business)
	for i := 2; i <= 10; i++ {
		s.openPersonal(br)
	}
	at := s.accountTypeOf(br)
	code, body := s.post(br, "/api/accounts", b618PersonalJSON)
	if code != http.StatusConflict || !strings.Contains(body, "you already hold 10 accounts") {
		t.Fatalf("the eleventh: %d (%s), want 409 with Lens's sentence", code, body)
	}
	if got := s.accountTypeOf(br); got != at {
		t.Fatalf("a refused open moved the session to %q", got)
	}
}

// Signing up again while signed in opens another account; it never lands in the one already held.
func TestB618_ASignUpWhileSignedInOpensAnotherAccount(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	br := s.browser()
	s.signUpIn(br, "b618-again", b618Business)
	first := deriveWorkspaceIDLikeLens(provisionIdentity(s.idp.srv.URL, "b618-again"))
	s.signUpIn(br, "b618-again", b618Personal)
	if got := s.accountTypeOf(br); !strings.HasPrefix(got, "personal ") || strings.HasSuffix(got, first) {
		t.Fatalf("a sign-up as Personal while signed in reaches %q, want a new personal account", got)
	}
	if list := s.accountsOf(br); len(list) != 2 {
		t.Fatalf("/api/accounts = %+v, want both accounts", list)
	}
}

// The phone sends its session as a Bearer token: a move answers the new token, and the old one is ended.
func TestB618_ThePhoneMovesWithItsBearerToken(t *testing.T) {
	s := startStrangerSuiteWith(t, []string{"*"}, func(c *config) { c.oidcMobileClientIDs = []string{"phone-ios"} })
	s.idp.sub, s.idp.email, s.idp.aud = "b618-phone", "b618-phone@example.org", "phone-ios"
	call := func(method, path, token, body string) (int, string) {
		req, _ := http.NewRequest(method, s.ts.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := s.ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	tokenOf := func(code int, body string) string {
		var out struct {
			Token string `json:"token"`
		}
		if code != http.StatusOK || json.Unmarshal([]byte(body), &out) != nil || out.Token == "" {
			t.Fatalf("got %d (%s), want 200 with a token", code, body)
		}
		return out.Token
	}
	old := tokenOf(call(http.MethodPost, mobileSessionPath, "",
		`{"id_token":"`+s.idp.mintIDToken("")+`","account_type":"business","money_kind":"stablecoin","name":"Northwind Studio"}`))
	opened := tokenOf(call(http.MethodPost, "/api/accounts", old, b618PersonalJSON))
	if code, body := call(http.MethodGet, "/api/workspace/account", opened, ""); code != http.StatusOK || !strings.Contains(body, `"account_type":"personal"`) {
		t.Fatalf("the new token reaches %d %s, want the personal account", code, body)
	}
	if code, _ := call(http.MethodGet, "/api/workspace/account", old, ""); code != http.StatusUnauthorized {
		t.Fatalf("the token from before the move still answers %d, want 401", code)
	}
	first := deriveWorkspaceIDLikeLens(provisionIdentity(s.idp.srv.URL, "b618-phone"))
	back := tokenOf(call(http.MethodPost, "/api/accounts/switch", opened, `{"account_id":"`+first+`"}`))
	if code, body := call(http.MethodGet, "/api/workspace/account", back, ""); !strings.Contains(body, `"account_type":"business"`) {
		t.Fatalf("after switching back the phone reaches %d %s, want the business account", code, body)
	}
}

// When the session's token runs out it is re-minted for the account the session is on, not the person's first.
func TestB618_TheTokenIsReMintedForTheAccountTheSessionIsOn(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	br := s.browser()
	s.signUpIn(br, "b618-remint", b618Business)
	s.lens.mu.Lock()
	s.lens.tokenLife = -time.Minute // every token Lens mints from here is already spent, so every request re-mints
	s.lens.mu.Unlock()
	second := s.openPersonal(br)
	for range 2 {
		if got := s.accountTypeOf(br); got != "personal "+second {
			t.Fatalf("after a re-mint the session reaches %q, want %s", got, second)
		}
	}
}

// An assistant's connection acts in the account it was made in, whichever account the browser is on since.
func TestB618_AConnectGrantKeepsTheAccountItWasMadeIn(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	br := s.browser()
	s.signUpIn(br, "b618-connect", b618Business)
	first := deriveWorkspaceIDLikeLens(provisionIdentity(s.idp.srv.URL, "b618-connect"))
	second := s.openPersonal(br)
	// The browser is on the second account. A grant made in the first, and one made in the second, both read back
	// with no token after a restart (oauth_store.go stores none), so each is re-minted here.
	for _, made := range []string{first, second} {
		got, ok := s.app.mcpTenant(t.Context(), oauthGrant{ID: "g-" + made, Who: oauthWho{sub: "b618-connect", workspaceID: made}})
		if !ok || got.workspaceID != made || got.token != "jwt-for-"+made {
			t.Errorf("a grant made in %s acts as %+v (ok %t), want that account and its own token", made, got, ok)
		}
	}
}
