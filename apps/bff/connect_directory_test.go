package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

// B52.8 — ChatGPT's directory reads back the token from the setting; unset, the path is not there.
func TestOpenAIAppsChallengeAnswersFromTheSetting(t *testing.T) {
	a, _ := oauthApp(t)
	if rec := serve(a, "GET", "/.well-known/openai-apps-challenge", "", "", nil, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unset: %d %q, want 404", rec.Code, rec.Body.String())
	}
	a.cfg.openAIAppsChallenge = "challenge-from-the-setting"
	rec := serve(a, "GET", "/.well-known/openai-apps-challenge", "", "", nil, nil)
	if rec.Code != http.StatusOK || rec.Body.String() != "challenge-from-the-setting" ||
		!strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("set: %d %q %v", rec.Code, rec.Body.String(), rec.Header())
	}
}

type directoryCase struct {
	ID        string              `json:"id"`
	Prompt    string              `json:"prompt"`
	Tool      string              `json:"tool"`
	Arguments map[string]any      `json:"arguments"`
	Expect    string              `json:"expect"`
	Shows     map[string][]string `json:"shows"`
}

// TestConnectDirectoryTestCases runs every test case the directories are given (testdata/connect/directory-test-cases.json)
// against the demo workspace, in the connector a person adds (full) and the one ChatGPT's directory lists (prepare_only).
func TestConnectDirectoryTestCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/connect/directory-test-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Server        string           `json:"server"`
		Cases         []directoryCase  `json:"cases"`
		NotForTalyvor []map[string]any `json:"not_for_talyvor"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if f.Server != "https://app.talyvor.com/mcp" || len(f.Cases) < 5 || len(f.NotForTalyvor) < 3 {
		t.Fatalf("the cases name %q, with %d cases and %d a Talyvor tool must not answer", f.Server, len(f.Cases), len(f.NotForTalyvor))
	}
	served := map[string]bool{}
	for _, tool := range mcpTools {
		served[tool.name] = true
	}
	for _, mode := range []string{"full", "prepare_only"} {
		for _, c := range f.Cases {
			if !served[c.Tool] || c.Prompt == "" || c.Expect == "" {
				t.Errorf("%s: a prompt, what to expect and a tool the server serves; it names %q", c.ID, c.Tool)
				continue
			}
			want, ok := c.Shows[mode]
			if !ok {
				t.Errorf("%s: says nothing of %s", c.ID, mode)
				continue
			}
			a, lens, token := agentsApp(t) // a fresh demo workspace for every case
			a.cfg.connectPrepareOnly = mode == "prepare_only"
			r := toolCall(t, a, token, c.Tool, c.Arguments)
			got, _ := json.Marshal(r)
			if r["isError"] != false && !(mode == "prepare_only" && strings.Contains(text(r), "Nothing has been paid")) {
				t.Errorf("%s (%s): %q answers an error: %s", c.ID, mode, c.Prompt, got)
				continue
			}
			for _, s := range want {
				if !strings.Contains(string(got), s) && !strings.Contains(text(r), s) {
					t.Errorf("%s (%s): %q answers without %q: %s", c.ID, mode, c.Prompt, s, got)
				}
			}
			if mode == "prepare_only" && lens.count("POST /v1/auth/connect-token") != 0 {
				t.Errorf("%s: prepare-only minted a token to pay with; Lens calls %v", c.ID, lens.calls)
			}
		}
	}
}
