package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testOperatorReadKey = "operator-read-key"

// B61.65 — a person at Talyvor closes ws_closed in Lens; the next sweep reads Lens's operator inbox for done closures,
// and ws_closed's Help chat and its questions counted today are gone. ws_open's stay.
func TestHelpChatGoesWhenTalyvorClosesTheAccount(t *testing.T) {
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.RequestURI())
		q := r.URL.Query()
		if r.URL.Path != "/v1/admin/requests" || r.Header.Get("Authorization") != "Bearer "+testOperatorReadKey ||
			q.Get("kind") != "account_closure" || q.Get("state") != "done" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"requests":[{"id":4,"workspace_id":"ws_closed","kind":"account_closure","state":"done",`+
			`"filed_by":"user:u_1","message":"","answer":"Closed.","filed_at":"2026-11-14T09:00:00Z","updated_at":"2026-11-15T09:00:00Z"}]}`)
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(),
		authMode: authModeDisabled, operatorReadKey: testOperatorReadKey}, nil)
	ctx := context.Background()
	for _, ws := range []string{"ws_closed", "ws_open"} {
		_ = a.help.add(ctx, helpWho{ws, "p_" + ws}, helpMessage{By: "you", Text: "a question from " + ws, At: time.Now()})
		_, _ = a.help.ask(ctx, ws, 1)
	}

	a.forgetClosedAccountsHelp(ctx)

	if len(asked) != 1 {
		t.Fatalf("Lens was asked %q, want the operator inbox once", asked)
	}
	if got, _ := a.help.chat(ctx, helpWho{"ws_closed", "p_ws_closed"}); len(got) != 0 {
		t.Errorf("the closed account's Help chat = %+v, want it gone", got)
	}
	if ok, _ := a.help.ask(ctx, "ws_closed", 1); !ok {
		t.Error("the closed account's questions counted today were kept")
	}
	if got, _ := a.help.chat(ctx, helpWho{"ws_open", "p_ws_open"}); len(got) != 1 {
		t.Errorf("an open account's Help chat = %+v, want it kept", got)
	}
}

// B61.65 — when the account's own requests come back from Lens with its closure done, its Help chat goes at once.
func TestHelpChatGoesWhenTheAccountReadsItsClosureDone(t *testing.T) {
	var calls []string
	state := "in_progress"
	a := fakeLensRequests(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"requests":[{"id":4,"workspace_id":"ws_x","kind":"account_closure","state":"`+state+`",`+
			`"filed_by":"user:u_1","message":"","answer":"","filed_at":"2026-11-14T09:00:00Z","updated_at":"2026-11-15T09:00:00Z"}]}`)
	}, &calls)
	own := deriveWorkspaceIDLikeLens(devIdentity)
	_ = a.help.add(context.Background(), devHelpWho(own), helpMessage{By: "you", Text: "How do I close my account?", At: time.Now()})

	doJSON(a, http.MethodGet, "/api/workspace/requests", "")
	if got, _ := a.help.chat(context.Background(), devHelpWho(own)); len(got) != 1 {
		t.Fatalf("with the closure in progress the Help chat = %+v, want it kept", got)
	}
	state = "done"
	if rec := doJSON(a, http.MethodGet, "/api/workspace/requests", ""); rec.Code != http.StatusOK {
		t.Fatalf("GET /api/workspace/requests = %d %s", rec.Code, rec.Body.String())
	}
	if got, _ := a.help.chat(context.Background(), devHelpWho(own)); len(got) != 0 {
		t.Errorf("with the closure done the Help chat = %+v, want it gone", got)
	}
}

// B61.65 — once closed, Help takes no more questions from the account: reading its requests again cannot start its
// day's count over, and nothing it asks is kept or reaches the model.
func TestHelpTakesNoQuestionsFromAClosedAccount(t *testing.T) {
	l := &helpLens{said: `{"answer":"Yes.","page":"","known":true,"team":false}`}
	a := newHelpApp(t, l, testHelpKey, 0)
	_ = a.help.closed(context.Background(), deriveWorkspaceIDLikeLens(devIdentity))
	code, _, said := helpReply(t, a, `{"question":"Can I still ask?"}`)
	if code != http.StatusForbidden || said != helpClosedAccount {
		t.Errorf("a closed account's question = %d %q, want 403 and %q", code, said, helpClosedAccount)
	}
	if len(l.bodies) != 0 {
		t.Errorf("the model was asked %d times for a closed account", len(l.bodies))
	}
	if kept := doJSON(a, http.MethodGet, "/api/help/chat", "").Body.String(); strings.Contains(kept, "Can I still ask?") {
		t.Errorf("a closed account's question was kept: %s", kept)
	}
}
