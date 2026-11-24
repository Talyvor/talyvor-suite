package main

// workspace_roles_test.go — B28.70: a role is taken up only by an email the person proved with a code mailed to it.
// Someone who typed another person's address sees no role and gets no session; the person who proved it opens the
// account with a role session, and a Viewer's fund goes to Lens on that role session, which refuses it.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"testing"
)

const (
	b2870Email   = "finn@northwind.example"
	b2870Account = "ws_northwind"
	b2870Token   = "role-token-viewer"
)

// roleLens answers B28.342's routes for one role (a Viewer, given to b2870Email in b2870Account) and hands every other
// request to the stranger Lens behind it.
type roleLens struct {
	mu      sync.Mutex
	asked   []map[string]any // each POST /v1/provision/roles body
	secrets []string         // the provision secret each carried
	funds   []string         // the bearer each fund in b2870Account carried
	owner   []string         // method, path, bearer and body of each owner roles route
}

func (l *roleLens) emailsAsked() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := []string{}
	for _, in := range l.asked {
		e, _ := in["email"].(string)
		out = append(out, e)
	}
	return out
}

func startRoleSuite(t *testing.T) (*strangerSuite, *roleLens, *testMailer) {
	t.Helper()
	rl := &roleLens{}
	var behind *httputil.ReverseProxy
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == provisionRolesPath:
			var in map[string]any
			_ = json.NewDecoder(r.Body).Decode(&in)
			rl.mu.Lock()
			rl.asked = append(rl.asked, in)
			rl.secrets = append(rl.secrets, r.Header.Get(provisionSecretHeader))
			rl.mu.Unlock()
			holds := in["email"] == b2870Email
			switch in["mode"] {
			case "list":
				if !holds {
					_, _ = io.WriteString(w, `{"accounts":[]}`)
					return
				}
				_, _ = io.WriteString(w, `{"accounts":[{"id":"ws_northwind","name":"Northwind","type":"business","kind":"fiat","role":"viewer"}]}`)
			case "session":
				if !holds || in["account_id"] != b2870Account {
					w.WriteHeader(http.StatusNotFound)
					_, _ = io.WriteString(w, `{"error":"no such account"}`)
					return
				}
				_, _ = io.WriteString(w, `{"workspace_id":"ws_northwind","role":"viewer","token":"`+b2870Token+`","expires_at":"2099-01-01T00:00:00Z"}`)
			}
		case strings.HasPrefix(r.URL.Path, "/v1/workspaces/"+b2870Account+"/agents/"):
			rl.mu.Lock()
			rl.funds = append(rl.funds, r.Header.Get("Authorization"))
			rl.mu.Unlock()
			w.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(w, `{"error":"auth: your role in this workspace does not allow this"}`)
		case strings.HasSuffix(r.URL.Path, "/roles"):
			raw, _ := io.ReadAll(r.Body)
			rl.mu.Lock()
			rl.owner = append(rl.owner, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Authorization")+" "+string(raw))
			rl.mu.Unlock()
			if r.Method == http.MethodDelete {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			_, _ = io.WriteString(w, `{"items":[],"roles":["viewer","finance","approver","admin"]}`)
		default:
			behind.ServeHTTP(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	s := startStrangerSuiteWith(t, []string{"*"}, func(c *config) {
		u, _ := url.Parse(c.lensBaseURL)
		behind = httputil.NewSingleHostReverseProxy(u)
		c.lensBaseURL = srv.URL
	})
	m := &testMailer{refuseOnce: map[string]bool{}, refuse: map[string]bool{}, tried: map[string]int{}}
	s.app.mail = m
	return s, rl, m
}

var sixDigitCode = regexp.MustCompile(`\b\d{6}\b`)

// codeMailedTo is the code in the last mail to addr.
func codeMailedTo(t *testing.T, m *testMailer, addr string) string {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := len(m.got) - 1; i >= 0; i-- {
		if m.got[i].to == addr {
			if c := sixDigitCode.FindString(m.got[i].body); c != "" {
				return c
			}
		}
	}
	t.Fatalf("no code was mailed to %s (mails: %v)", addr, m.got)
	return ""
}

// The red-first test (v7 chat, 24 Nov): someone who types another person's address — even the address their own
// sign-in carried — and cannot give the code mailed to it sees no role and gets no session, and Lens is never told it.
func TestB2870_ATypedAddressShowsNoRoleAndOpensNoSession(t *testing.T) {
	s, rl, m := startRoleSuite(t)
	eve := s.signUp("b2870-eve", b2870Email)

	if code, body := s.post(eve, "/api/roles/email/code", `{"email":"`+b2870Email+`"}`); code != http.StatusOK {
		t.Fatalf("asking for a code: %d %s, want 200", code, body)
	}
	real := codeMailedTo(t, m, b2870Email) // in Finn's mailbox, not Eve's
	guess := "000000"
	if real == guess {
		guess = "111111"
	}
	if code, body := s.post(eve, "/api/roles/email/check", `{"email":"`+b2870Email+`","code":"`+guess+`"}`); code != http.StatusBadRequest {
		t.Fatalf("a wrong code: %d %s, want 400", code, body)
	}

	if body := s.getBody(eve, "/api/roles"); strings.Contains(body, b2870Account) || strings.Contains(body, b2870Email) {
		t.Fatalf("GET /api/roles showed %s, want no role and no address", body)
	}
	for _, acc := range s.accountsOf(eve) {
		if acc.ID == b2870Account || acc.Role != "" {
			t.Fatalf("the switcher listed %+v, want only Eve's own accounts", acc)
		}
	}
	if code, body := s.post(eve, "/api/accounts/switch", `{"account_id":"`+b2870Account+`"}`); code != http.StatusNotFound {
		t.Fatalf("switching into the role's account: %d %s, want 404", code, body)
	}
	if got := s.me(eve)["workspace_id"]; got == b2870Account {
		t.Fatal("Eve's session moved into the role's account")
	}
	if asked := rl.emailsAsked(); len(asked) != 0 {
		t.Fatalf("Lens was asked about %q, want never", asked)
	}
}

// Finn proves the address with the code mailed to it: the switcher lists Northwind as a Viewer, opening it gives a role
// session, and a fund from it reaches Lens on the role's token — never the owner's — and comes back refused.
func TestB2870_AProvedAddressOpensTheRoleAndAViewersFundIsRefused(t *testing.T) {
	s, rl, m := startRoleSuite(t)
	finn := s.signUp("b2870-finn", "")
	own := s.me(finn)["workspace_id"]

	if code, body := s.post(finn, "/api/roles/email/code", `{"email":"Finn@Northwind.example"}`); code != http.StatusOK {
		t.Fatalf("asking for a code: %d %s, want 200", code, body)
	}
	if code, body := s.post(finn, "/api/roles/email/check", `{"email":"`+b2870Email+`","code":"`+codeMailedTo(t, m, b2870Email)+`"}`); code != http.StatusOK {
		t.Fatalf("the right code: %d %s, want 200", code, body)
	}
	var listed *personAccount
	for _, acc := range s.accountsOf(finn) {
		if acc.ID == b2870Account {
			listed = &acc
		}
	}
	if listed == nil || listed.Role != "viewer" || listed.Current {
		t.Fatalf("the switcher listed %+v, want Northwind as a Viewer, not current", listed)
	}
	if code, body := s.post(finn, "/api/accounts/switch", `{"account_id":"`+b2870Account+`"}`); code != http.StatusOK {
		t.Fatalf("opening Northwind: %d %s, want 200", code, body)
	}
	if got := s.me(finn)["workspace_id"]; got != b2870Account {
		t.Fatalf("the session is on %v, want %s", got, b2870Account)
	}

	code, body := s.post(finn, "/api/agents/agt_1/fund", `{"amount_minor":500,"currency":"USD"}`)
	if code != http.StatusForbidden {
		t.Fatalf("a Viewer's fund answered %d %s, want Lens's 403", code, body)
	}
	rl.mu.Lock()
	funds := append([]string{}, rl.funds...)
	secrets := append([]string{}, rl.secrets...)
	rl.mu.Unlock()
	if len(funds) != 1 || funds[0] != "Bearer "+b2870Token {
		t.Fatalf("the fund reached Lens on %q, want once on the role's token", funds)
	}
	for _, sec := range secrets {
		if sec != testProvisionSecret {
			t.Fatalf("a roles call carried %q, want the provision secret", sec)
		}
	}

	// And back to Finn's own account, where the session holds no role.
	if code, body := s.post(finn, "/api/accounts/switch", `{"account_id":"`+own.(string)+`"}`); code != http.StatusOK {
		t.Fatalf("back to Finn's own account: %d %s, want 200", code, body)
	}
	for _, acc := range s.accountsOf(finn) {
		if acc.Current && (acc.ID != own || acc.Role != "") {
			t.Fatalf("current is %+v, want Finn's own account with no role", acc)
		}
	}
}

// The owner's roles go to Lens on the session's own token, and a give carries only the email and the role.
func TestB2870_TheOwnersRolesRelayOnTheSessionsToken(t *testing.T) {
	s, rl, _ := startRoleSuite(t)
	ada := s.signUp("b2870-ada", "ada@example.org")
	_ = s.getBody(ada, "/api/workspace/roles")
	req, _ := http.NewRequest(http.MethodPut, s.ts.URL+"/api/workspace/roles", strings.NewReader(`{"email":"finn@northwind.example","role":"viewer","workspace_id":"ws_other"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", s.app.cfg.publicBaseURL)
	resp, err := ada.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT roles: %v %v", resp, err)
	}
	_ = resp.Body.Close()
	ws, _ := s.me(ada)["workspace_id"].(string)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if len(rl.owner) != 2 || !strings.HasPrefix(rl.owner[0], "GET /v1/workspaces/"+ws+"/roles Bearer ") ||
		!strings.HasPrefix(rl.owner[1], "PUT /v1/workspaces/"+ws+"/roles Bearer ") ||
		!strings.HasSuffix(rl.owner[1], ` {"email":"finn@northwind.example","role":"viewer"}`) {
		t.Fatalf("Lens received %q, want GET then PUT on the session's workspace with only email and role", rl.owner)
	}
}

// The code routes write nothing upstream, so the Origin sweep cannot see them: from another site they are refused, and
// no mail goes.
func TestB2870_TheEmailCodeRoutesRefuseAnotherSite(t *testing.T) {
	s, _, m := startRoleSuite(t)
	finn := s.signUp("b2870-finn", "")
	for _, rt := range []struct{ path, body string }{
		{"/api/roles/email/code", `{"email":"` + b2870Email + `"}`},
		{"/api/roles/email/check", `{"email":"` + b2870Email + `","code":"123456"}`},
	} {
		req, _ := http.NewRequest(http.MethodPost, s.ts.URL+rt.path, strings.NewReader(rt.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://evil.example")
		resp, err := finn.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s from another site answered %d, want 403", rt.path, resp.StatusCode)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.got) != 0 || len(m.tried) != 0 {
		t.Fatalf("a mail went: %v", m.got)
	}
}
