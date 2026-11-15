package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeLensAccount answers GET /v1/workspaces/{ws}/account the way Lens B59.6 does, for the dev session's own workspace
// and its own token only; any other workspace or credential gets Lens's 404. It records every path the BFF asks for.
func fakeLensAccount(t *testing.T, body string, paths *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		*paths = append(*paths, r.Method+" "+r.URL.RequestURI())
		if r.URL.Path != "/v1/workspaces/"+own+"/account" || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)
}

// B59.10 — the web reads its workspace's type and kind of money. It answers Lens's two words for the session's own
// workspace, whatever workspace the request names.
func TestWorkspaceAccountAnswersTheSessionsOwnTypeAndKind(t *testing.T) {
	var paths []string
	a := fakeLensAccount(t, `{"workspace_id":"ws_own","account_type":"personal","money_kind":"stablecoin"}`, &paths)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/workspace/account?workspace_id=SOMEBODY-ELSE", nil)
	req.Header.Set("X-Talyvor-Workspace", "SOMEBODY-ELSE")
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != "{\"workspace_id\":\"ws_own\",\"account_type\":\"personal\",\"money_kind\":\"stablecoin\",\"country\":\"\",\"registration_number\":\"\"}\n" {
		t.Fatalf("GET /api/workspace/account = %d %q, want 200 with Lens's type and kind", rec.Code, rec.Body.String())
	}
	want := "GET /v1/workspaces/" + deriveWorkspaceIDLikeLens(devIdentity) + "/account"
	if len(paths) != 1 || paths[0] != want {
		t.Errorf("Lens was asked %v, want only %q", paths, want)
	}
}

// A type or kind Lens does not name is a failed read, never a guess the web would draw screens by.
func TestWorkspaceAccountRefusesAnUnknownTypeOrKind(t *testing.T) {
	for _, body := range []string{`not json`, `{"account_type":"business"}`, `{"account_type":"family","money_kind":"fiat"}`, `{"account_type":"personal","money_kind":"gold"}`} {
		var paths []string
		if rec := doJSON(fakeLensAccount(t, body, &paths), http.MethodGet, "/api/workspace/account", ""); rec.Code != http.StatusBadGateway {
			t.Errorf("Lens answered %s: BFF = %d %s, want 502", body, rec.Code, rec.Body.String())
		}
	}
	var paths []string
	if rec := doJSON(fakeLensAccount(t, `{}`, &paths), http.MethodPost, "/api/workspace/account", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/workspace/account = %d, want 405", rec.Code)
	}
}

// B59.43 — the phone reads the same route, and a business's sign-up profile with it (Lens B59.40): the country and
// registration number pass through as Lens answers them, "" when not given.
func TestWorkspaceAccountAnswersTheSignUpProfile(t *testing.T) {
	var paths []string
	a := fakeLensAccount(t, `{"workspace_id":"ws_own","account_type":"business","money_kind":"hybrid","country":"GB","registration_number":"17299143"}`, &paths)
	rec := doJSON(a, http.MethodGet, "/api/workspace/account", "")
	want := "{\"workspace_id\":\"ws_own\",\"account_type\":\"business\",\"money_kind\":\"hybrid\",\"country\":\"GB\",\"registration_number\":\"17299143\"}\n"
	if rec.Code != http.StatusOK || rec.Body.String() != want {
		t.Fatalf("GET /api/workspace/account = %d %q, want 200 %q", rec.Code, rec.Body.String(), want)
	}
}

// fakeLensMoneyKind answers the money-kind challenge and change the way Lens B59.46 does, for the session's own
// workspace only, and records each method, path and body the BFF sent.
func fakeLensMoneyKind(t *testing.T, status int, answer string, sent *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		*sent = append(*sent, r.Method+" "+r.URL.RequestURI()+" "+string(body))
		if !strings.HasPrefix(r.URL.Path, "/v1/workspaces/"+own+"/account/money-kind") || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, answer)
	}))
	t.Cleanup(srv.Close)
	return newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)
}

// B59.12 — changing the kind is asked of Lens for the session's own workspace: the challenge for the kind picked, then
// the change carrying the owner's signature over it, both as the browser sent them.
func TestWorkspaceMoneyKindChallengeAndSignedChangeReachLens(t *testing.T) {
	own := deriveWorkspaceIDLikeLens(devIdentity)
	var sent []string
	a := fakeLensMoneyKind(t, http.StatusOK, `{"challenge":"c1","allow_credentials":["k1"],"user_verification":"required"}`, &sent)
	rec := doJSON(a, http.MethodPost, "/api/workspace/account/money-kind/challenge", `{"money_kind":"hybrid","workspace_id":"SOMEBODY-ELSE"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"challenge":"c1"`) {
		t.Fatalf("challenge = %d %q, want Lens's challenge", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPut, "/api/workspace/account/money-kind",
		`{"money_kind":"hybrid","assertion":{"credential_id":"k1","client_data_json":"cd","authenticator_data":"ad","signature":"sg"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("change = %d %q, want 200", rec.Code, rec.Body.String())
	}
	want := []string{
		`POST /v1/workspaces/` + own + `/account/money-kind/challenge {"money_kind":"hybrid"}`,
		`PUT /v1/workspaces/` + own + `/account/money-kind {"money_kind":"hybrid","assertion":{"credential_id":"k1","client_data_json":"cd","authenticator_data":"ad","signature":"sg"}}`,
	}
	if strings.Join(sent, "\n") != strings.Join(want, "\n") {
		t.Errorf("Lens was sent\n%s\nwant\n%s", strings.Join(sent, "\n"), strings.Join(want, "\n"))
	}
}

// Lens's refusal to narrow while the other side holds money reaches the web as Lens said it, balances and all.
func TestWorkspaceMoneyKindRefusalNamesTheBalances(t *testing.T) {
	var sent []string
	refusal := `{"error":"the account still holds 16700.00 USDC: move it out first","code":"wrong_money_kind","field":"money_kind","money_kind":"hybrid","balances":{"USDC":1670000}}`
	a := fakeLensMoneyKind(t, http.StatusConflict, refusal, &sent)
	rec := doJSON(a, http.MethodPut, "/api/workspace/account/money-kind",
		`{"money_kind":"fiat","assertion":{"credential_id":"k1","client_data_json":"cd","authenticator_data":"ad","signature":"sg"}}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"balances":{"USDC":1670000}`) {
		t.Fatalf("change = %d %q, want Lens's 409 with the balances", rec.Code, rec.Body.String())
	}
}

// A kind Lens does not name, or a change with no signature, is refused here and never reaches Lens.
func TestWorkspaceMoneyKindRefusesAnUnknownKindOrNoSignature(t *testing.T) {
	var sent []string
	a := fakeLensMoneyKind(t, http.StatusOK, `{}`, &sent)
	for _, c := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/workspace/account/money-kind/challenge", `{"money_kind":"gold"}`},
		{http.MethodPut, "/api/workspace/account/money-kind", `{"money_kind":"gold","assertion":{"credential_id":"k1","signature":"sg"}}`},
		{http.MethodPut, "/api/workspace/account/money-kind", `{"money_kind":"hybrid"}`},
		{http.MethodGet, "/api/workspace/account/money-kind", ``},
	} {
		if rec := doJSON(a, c.method, c.path, c.body); rec.Code != http.StatusBadRequest && rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s %s = %d, want refused", c.method, c.path, c.body, rec.Code)
		}
	}
	if len(sent) != 0 {
		t.Errorf("Lens was asked %v, want nothing", sent)
	}
}
