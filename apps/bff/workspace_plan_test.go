package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeLensPlan answers GET /v1/workspaces/{ws}/plan the way Lens's newWorkspacePlanHandler does, for the dev session's
// own workspace and its own token only; any other workspace or credential gets Lens's 404.
func fakeLensPlan(t *testing.T, body string, paths *[]string) *app {
	t.Helper()
	own := deriveWorkspaceIDLikeLens(devIdentity)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		*paths = append(*paths, r.Method+" "+r.URL.RequestURI())
		if r.URL.Path != "/v1/workspaces/"+own+"/plan" || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
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

// B57.18 — Home's "3 of 3 on Free": the session's own workspace's plan, the agents its plan allows (-1 is unlimited)
// and the agents it has, as Lens answers them, whatever workspace the request names. B57.44 — and the seats it has, for
// Members' "Free has 1 seat" before anyone tries to add a person.
func TestWorkspacePlanAnswersTheSessionsOwnPlanAndAgents(t *testing.T) {
	var paths []string
	a := fakeLensPlan(t, `{"plan":"personal_solo","name":"Solo","account_type":"personal","ladder":["personal_solo","personal_crew","personal_fleet"],`+
		`"on_contract":false,"price_minor":{"GBP":0,"EUR":0,"USD":0},"gated_as":"personal_solo","byok_add_on":false,`+
		`"gates":{"agents":3,"seats":1,"own_provider_keys":"none"},"own_provider_keys_allowed":false,"agents_used":3}`, &paths)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/plan?workspace_id=SOMEBODY-ELSE", nil)
	req.Header.Set("X-Talyvor-Workspace", "SOMEBODY-ELSE")
	a.ServeHTTP(rec, req)

	if want := `{"plan":"personal_solo","name":"Solo","account_type":"personal","on_contract":false,"price_minor":{"EUR":0,"GBP":0,"USD":0},"agents":3,"agents_used":3,"seats":1}` + "\n"; rec.Code != http.StatusOK || rec.Body.String() != want {
		t.Fatalf("GET /api/plan = %d %q, want 200 %q", rec.Code, rec.Body.String(), want)
	}
	if want := "GET /v1/workspaces/" + deriveWorkspaceIDLikeLens(devIdentity) + "/plan"; len(paths) != 1 || paths[0] != want {
		t.Errorf("Lens was asked %v, want only %q", paths, want)
	}
}

// An answer with no plan, or counts that are not counts, is a failed read: Home never draws a guessed plan line.
func TestWorkspacePlanRefusesAnUnreadableAnswer(t *testing.T) {
	const whole = `"name":"Team","account_type":"business","price_minor":{"USD":1000},`
	for _, body := range []string{`not json`, `{"plan":"team","account_type":"business","price_minor":{"USD":1000},"gates":{"agents":25,"seats":5},"agents_used":1}`,
		`{"plan":"team","name":"Team","account_type":"team","gates":{"agents":25,"seats":5},"agents_used":1}`,
		`{"plan":"team","name":"Team","account_type":"business","price_minor":{"USD":-1},"gates":{"agents":25,"seats":5},"agents_used":1}`, `{"gates":{"agents":3},"agents_used":1}`, `{"plan":"team",` + whole + `"gates":{"agents":-2},"agents_used":1}`, `{"plan":"team",` + whole + `"gates":{"agents":25,"seats":5},"agents_used":-1}`,
		`{"plan":"team",` + whole + `"gates":{"agents":25},"agents_used":1}`, `{"plan":"team",` + whole + `"gates":{"agents":25,"seats":-2},"agents_used":1}`} {
		var paths []string
		if rec := doJSON(fakeLensPlan(t, body, &paths), http.MethodGet, "/api/plan", ""); rec.Code != http.StatusBadGateway {
			t.Errorf("Lens answered %s: BFF = %d %s, want 502", body, rec.Code, rec.Body.String())
		}
	}
	var paths []string
	if rec := doJSON(fakeLensPlan(t, `{}`, &paths), http.MethodPost, "/api/plan", "{}"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/plan = %d, want 405", rec.Code)
	}
}

// B61.59 — Change plan: the plan's id alone goes to Lens on the session's own workspace, whatever workspace the request
// names, and Lens's refusal reaches Settings, Plan in its own words with its status.
func TestWorkspacePlanChangeSendsThePlanAndPassesLensRefusalOn(t *testing.T) {
	own := deriveWorkspaceIDLikeLens(devIdentity)
	var sent []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		sent = append(sent, r.Method+" "+r.URL.Path+" "+string(raw))
		if r.Method != http.MethodPut || r.URL.Path != "/v1/workspaces/"+own+"/plan" || r.Header.Get("Authorization") != "Bearer jwt-for-"+own {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if string(raw) == `{"plan":"personal_solo"}` {
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `{"error":"Solo allows 3 agents, and this account has 5. Archive 2 agents first.","plan":"personal_crew","to":"personal_solo"}`)
			return
		}
		_, _ = io.WriteString(w, `{"from":"personal_solo","plan":"personal_crew","name":"Crew"}`)
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodPut, "/api/plan?workspace_id=SOMEBODY-ELSE", `{"plan":"personal_crew","members":0,"workspace_id":"SOMEBODY-ELSE"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"plan":"personal_crew"`) {
		t.Fatalf("PUT /api/plan = %d %s, want 200 with Lens's answer", rec.Code, rec.Body.String())
	}
	if want := "PUT /v1/workspaces/" + own + `/plan {"plan":"personal_crew"}`; len(sent) != 1 || sent[0] != want {
		t.Errorf("Lens was sent %q, want only %q", sent, want)
	}

	rec = doJSON(a, http.MethodPut, "/api/plan", `{"plan":"personal_solo"}`)
	if want := "{\"error\":\"Solo allows 3 agents, and this account has 5. Archive 2 agents first.\"}\n"; rec.Code != http.StatusConflict || rec.Body.String() != want {
		t.Errorf("a refused move down = %d %q, want 409 %q", rec.Code, rec.Body.String(), want)
	}

	sent = nil
	if rec := doJSON(a, http.MethodPut, "/api/plan", `{}`); rec.Code != http.StatusBadRequest || len(sent) != 0 {
		t.Errorf("PUT /api/plan with no plan = %d, Lens sent %q; want 400 and nothing sent", rec.Code, sent)
	}
}
