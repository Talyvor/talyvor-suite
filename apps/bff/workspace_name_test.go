package main

import (
	"net/http"
	"strings"
	"testing"
)

// B46.16 — sign-up's workspace name reaches Lens's name route for the session's own workspace, the body rebuilt
// to {"name"} alone, and Lens's answer comes back.
func TestWorkspaceNameReachesTheSessionsWorkspace(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodPut, "/api/workspace/name", `{"name":"Acme","workspace_id":"ws_other"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"name":"Acme"`) {
		t.Fatalf("rename = %d %s", rec.Code, rec.Body.String())
	}
	if len(f.got) != 1 || !strings.HasPrefix(f.got[0], "PUT /v1/workspaces/") || !strings.HasSuffix(f.got[0], `/name {"name":"Acme"}`) ||
		strings.Contains(f.got[0], "ws_other") {
		t.Fatalf("Lens received %q, want the session's workspace and {\"name\"} alone", f.got)
	}
}
