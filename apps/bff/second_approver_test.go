package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeLensSecondApprover answers Lens B28.315's second-approver routes for the session's own workspace only, and
// records each method, path and body the BFF sent.
func fakeLensSecondApprover(t *testing.T, status int, answer string, sent *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		*sent = append(*sent, r.Method+" "+r.URL.RequestURI()+" "+string(body))
		if !strings.HasPrefix(r.URL.Path, "/v1/workspaces/"+own+"/second-approver") || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
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

// B28.40 — the owner's line is read, its challenge asked and the signed line set on Lens for the session's own
// workspace, rebuilt field by field: a workspace or anything else the browser adds never reaches Lens.
func TestSecondApproverReadChallengeAndSignedSetReachLens(t *testing.T) {
	own := deriveWorkspaceIDLikeLens(devIdentity)
	var sent []string
	a := fakeLensSecondApprover(t, http.StatusOK, `{"user_id":"pabc","above_minor":500000,"currency":"GBP"}`, &sent)
	if rec := doJSON(a, http.MethodGet, "/api/workspace/second-approver", ``); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"user_id":"pabc"`) {
		t.Fatalf("read = %d %q, want Lens's line", rec.Code, rec.Body.String())
	}
	line := `"user_id":"pabc","above_minor":500000,"currency":"GBP"`
	if rec := doJSON(a, http.MethodPost, "/api/workspace/second-approver/challenge", `{`+line+`,"workspace_id":"SOMEBODY-ELSE","assertion":{"credential_id":"k1"}}`); rec.Code != http.StatusOK {
		t.Fatalf("challenge = %d %q, want 200", rec.Code, rec.Body.String())
	}
	signed := `"assertion":{"credential_id":"k1","client_data_json":"cd","authenticator_data":"ad","signature":"sg"}`
	if rec := doJSON(a, http.MethodPut, "/api/workspace/second-approver", `{`+line+`,`+signed+`,"set_by":"me"}`); rec.Code != http.StatusOK {
		t.Fatalf("set = %d %q, want 200", rec.Code, rec.Body.String())
	}
	want := []string{
		`GET /v1/workspaces/` + own + `/second-approver `,
		`POST /v1/workspaces/` + own + `/second-approver/challenge {` + line + `}`,
		`PUT /v1/workspaces/` + own + `/second-approver {` + line + `,` + signed + `}`,
	}
	if strings.Join(sent, "\n") != strings.Join(want, "\n") {
		t.Errorf("Lens was sent\n%s\nwant\n%s", strings.Join(sent, "\n"), strings.Join(want, "\n"))
	}
}

// A Personal account's 404 not_business reaches the web with its code, so the screen draws no second approver.
func TestSecondApproverPersonalRefusalKeepsItsCode(t *testing.T) {
	var sent []string
	a := fakeLensSecondApprover(t, http.StatusNotFound, `{"error":"a Personal account has no second approver","code":"not_business"}`, &sent)
	rec := doJSON(a, http.MethodGet, "/api/workspace/second-approver", ``)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"not_business"`) {
		t.Fatalf("read = %d %q, want Lens's 404 not_business", rec.Code, rec.Body.String())
	}
}
