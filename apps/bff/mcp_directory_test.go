package main

import (
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// B40.20 — the check Nicolai runs before submitting Talyvor to Claude's connector directory
// (claude.ai/directory/manage): `go test -run TestMCPClaudeDirectory ./` in apps/bff. It holds every tool the server lists
// to the directory's rules, and the listing the docs page shows (claude-connector.json) to the tools the server serves.

const claudeListing = "../web/src/areas/documentation/claude-connector.json"

type claudeConnectorListing struct {
	Server          string   `json:"server"`
	AllowedLinkURIs []string `json:"allowedLinkUris"`
	ExamplePrompts  []string `json:"examplePrompts"`
	Tools           []struct {
		Name, Title, Kind string
	} `json:"tools"`
}

// mcpInstructs is wording that tells the model what to do rather than says what the tool does: the directory refuses
// a description that reads as a prompt injection.
var mcpInstructs = regexp.MustCompile(`(?i)\b(ignore|disregard|system prompt|you must|you should|always|do not tell|don't tell|` +
	`instead of|before (calling|using|answering)|important|assistant must|the model)\b|<[a-z/!]`)

var mcpToolName = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)

func TestMCPClaudeDirectory(t *testing.T) {
	raw, err := os.ReadFile(claudeListing)
	if err != nil {
		t.Fatal(err)
	}
	var l claudeConnectorListing
	if err := json.Unmarshal(raw, &l); err != nil {
		t.Fatalf("%s: %v", claudeListing, err)
	}
	if l.Server != "https://app.talyvor.com/mcp" {
		t.Errorf("the listing names the server %q", l.Server)
	}
	for _, p := range []string{"What's due this week?", "Prepare payment of my bills due Friday", "Find a translation agent under £20 a month"} {
		if !slices.Contains(l.ExamplePrompts, p) {
			t.Errorf("the listing's example prompts lack %q", p)
		}
	}
	if len(l.ExamplePrompts) < 3 || !slices.Contains(l.AllowedLinkURIs, "talyvor:") {
		t.Errorf("at least three example prompts and talyvor: among the allowed link URIs; the listing has %v and %v", l.ExamplePrompts, l.AllowedLinkURIs)
	}

	if len(l.Tools) != len(mcpTools) {
		t.Fatalf("the listing shows %d tools and the server serves %d", len(l.Tools), len(mcpTools))
	}
	args, _ := json.Marshal(map[string]any{"name": "Acme Ltd", "country": "GB", "iban": "GB33BUKB20201555555555", "expires_at": "2027-01-31T00:00:00Z",
		"scope": map[string]any{"currencies": []any{"GBP"}}, "new_payee": map[string]any{"policy": "always_ask"}, "idempotency_key": "k",
		"payee_id": "py-1", "currency": "GBP", "amount_minor": 1, "listing_id": "l-1", "request_id": "pr-1", "invoice_id": "inv-1",
		"account_id": "acc-1", "customer_name": "Acme Ltd", "due_date": "2026-11-30", "items": []any{map[string]any{"payee_id": "py-1"}}})
	var parsed mcpArgs
	_ = json.Unmarshal(args, &parsed)
	for i, tool := range mcpTools {
		def := tool.definition(oauthGrant{Scope: strings.Join(oauthScopeNames(), " ")})
		ann := def["annotations"].(map[string]any)
		ro, roOK := ann["readOnlyHint"].(bool)
		de, deOK := ann["destructiveHint"].(bool)
		kind := map[int]string{mcpReads: "read", mcpWrites: "write", mcpSends: "send"}[tool.kind]
		switch {
		case !mcpToolName.MatchString(tool.name):
			t.Errorf("%q: a name of at most 64 lower-case letters, digits and underscores", tool.name)
		case tool.title == "" || ann["title"] != tool.title:
			t.Errorf("%s: a title, in the tool and its annotations", tool.name)
		case !roOK || !deOK || ro && de:
			t.Errorf("%s: readOnlyHint and destructiveHint both stated, and not both true; it has %v", tool.name, ann)
		case l.Tools[i].Name != tool.name || l.Tools[i].Title != tool.title || l.Tools[i].Kind != kind:
			t.Errorf("the listing's tool %d is %+v; the server serves %s %q (%s)", i, l.Tools[i], tool.name, tool.title, kind)
		}
		for _, d := range descriptions(def) {
			if m := mcpInstructs.FindString(d); m != "" {
				t.Errorf("%s: %q reads as an instruction to the model (%q)", tool.name, d, m)
			}
		}
		// Separate read and write tools: a read tool only ever reads, and a write tool never just reads.
		if tool.run != nil {
			continue // Taly and the microphone make no one Lens request: TestMCPTalyForTheDesktopApp holds them
		}
		c, err := tool.call(tenant{workspaceID: "ws-1"}, oauthGrant{ClientID: "c-1"}, parsed, args)
		if err != nil {
			t.Errorf("%s: %v", tool.name, err)
		} else if ro != (c.method == http.MethodGet) {
			t.Errorf("%s: readOnlyHint %v, and its call is %q %s", tool.name, ro, c.method, c.path)
		}
	}

	// Every link a tool answers with is one the listing declares.
	a, _, ck := mcpApp(t)
	client := jsonOf(t, serve(a, "POST", "/oauth/register", "", `{"client_name":"Claude","redirect_uris":["`+claudeReturn+`"]}`, nil, nil))
	token := connect(t, a, ck, client["client_id"].(string))["access_token"].(string)
	r := toolCall(t, a, token, "prepare_payment", map[string]any{"idempotency_key": "k-1", "payee_id": "py-1", "currency": "GBP", "amount_minor": 4200})
	out := r["structuredContent"].(map[string]any)
	links := []string{out["approval_url"].(string), out["deep_link"].(string)}
	for _, c := range r["content"].([]any) {
		if uri, ok := c.(map[string]any)["uri"].(string); ok {
			links = append(links, uri)
		}
	}
	for _, link := range links {
		if !slices.ContainsFunc(l.AllowedLinkURIs, func(p string) bool { return strings.HasPrefix(link, p) }) {
			t.Errorf("prepare_payment answers with %q, which no allowed link URI in the listing covers", link)
		}
	}
}

// descriptions is every description in a tool's definition: its own and each argument's, however deep.
func descriptions(v any) []string {
	var out []string
	switch x := v.(type) {
	case map[string]any:
		for k, e := range x {
			if s, ok := e.(string); ok && k == "description" {
				out = append(out, s)
			}
			out = append(out, descriptions(e)...)
		}
	case []any:
		for _, e := range x {
			out = append(out, descriptions(e)...)
		}
	}
	return out
}
