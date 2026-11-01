package main

import (
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeLensForTaly answers what ask_taly, list_approvals and transcribe ask Lens, per workspace token, and records each call.
type fakeLensForTaly struct {
	mu     sync.Mutex
	calls  []string          // "METHOD /path Bearer … feature"
	called []map[string]any  // the arguments of each Lens /mcp tools/call
	asked  []json.RawMessage // each model request
	audio  string            // the recording's bytes and type, as transcription received them
}

func (f *fakeLensForTaly) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	auth := r.Header.Get("Authorization")
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, r.Method+" "+r.URL.Path+" "+auth+" "+r.Header.Get(featureHeader))
	w.Header().Set("Content-Type", "application/json")
	ws := strings.TrimPrefix(auth, "Bearer jwt-") // the workspace a token belongs to, and its chat key's
	ws = strings.TrimPrefix(ws, "Bearer sk-")
	switch r.Method + " " + r.URL.Path {
	case "POST " + lensSessionKeyPath:
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"key":"sk-`+ws+`","expires_at":"`+time.Now().Add(time.Hour).Format(time.RFC3339)+`"}`)
	case "GET /v1/catalog/models":
		_, _ = io.WriteString(w, `[{"id":"claude-old","provider":"anthropic","tier":"frontier","release_date":"2025-01-01"},`+
			`{"id":"claude-new","provider":"anthropic","tier":"frontier","release_date":"2026-06-01"},`+
			`{"id":"claude-fast","provider":"anthropic","tier":"fast","release_date":"2026-09-01"},`+
			`{"id":"gpt-x","provider":"openai","tier":"frontier","release_date":"2026-10-01"}]`)
	case "GET /v1/money/payment-requests":
		if r.URL.Query().Get("status") != "pending_approval" {
			http.Error(w, `{"error":"status"}`, http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, `{"requests":[`+
			`{"id":"pr-`+ws+`-old","summary":"Northern Power","totals":{"GBP":16550},"approval_url":"https://app.talyvor.com/approve/pr-`+ws+`-old","created_at":"2026-10-30T09:00:00Z"},`+
			`{"id":"pr-`+ws+`-new","summary":"ACME Ltd","totals":{"USD":4200},"approval_url":"https://app.talyvor.com/approve/pr-`+ws+`-new","created_at":"2026-10-31T09:00:00Z"}]}`)
	case "POST /v1/audio/transcriptions":
		_, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		form, err := multipart.NewReader(strings.NewReader(string(raw)), params["boundary"]).ReadForm(1 << 20)
		if err != nil || len(form.File["file"]) != 1 {
			http.Error(w, `{"error":"a recording is required"}`, http.StatusBadRequest)
			return
		}
		fh := form.File["file"][0]
		file, _ := fh.Open()
		b, _ := io.ReadAll(file)
		f.audio = string(b) + " " + fh.Header.Get("Content-Type")
		_, _ = io.WriteString(w, `{"text":"pay mike fifty pounds for `+ws+`"}`)
	case "POST /mcp":
		var rpc struct {
			Method string `json:"method"`
			Params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			} `json:"params"`
		}
		_ = json.Unmarshal(raw, &rpc)
		if rpc.Method == "tools/list" {
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"tools":[`+
				`{"name":"wallet_agents_spend","description":"What the agents spent.","inputSchema":{"type":"object","properties":{}}},`+
				`{"name":"prepare_payment","description":"Prepares a payment.","inputSchema":{"type":"object","properties":{"payee_id":{"type":"string"},"client":{"type":"string"},"idempotency_key":{"type":"string"}}}},`+
				`{"name":"wallet_send","description":"Sends money.","inputSchema":{"type":"object","properties":{}}}]}}`)
			return
		}
		f.called = append(f.called, map[string]any{"name": rpc.Params.Name, "arguments": rpc.Params.Arguments})
		text := `{"agents":[{"name":"Researcher","spent_ulxc":1200}]}`
		if rpc.Params.Name == "prepare_payment" {
			text = `{"id":"pr-9","status":"pending_approval","approval_url":"https://app.talyvor.com/approve/pr-9"}`
		}
		out, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}}})
		_, _ = w.Write(out)
	case "POST /v1/proxy/anthropic/v1/messages":
		f.asked = append(f.asked, raw)
		if len(f.asked)%2 == 1 {
			// The model calls Chat's tools, and one Chat may never use.
			_, _ = io.WriteString(w, `{"stop_reason":"tool_use","content":[{"type":"text","text":"Let me look."},`+
				`{"type":"tool_use","id":"tu-1","name":"wallet_agents_spend","input":{}},`+
				`{"type":"tool_use","id":"tu-2","name":"prepare_payment","input":{"payee_id":"py-mike","client":"chat","idempotency_key":"mine"}},`+
				`{"type":"tool_use","id":"tu-3","name":"wallet_send","input":{"to":"anyone"}}]}`)
			return
		}
		_, _ = io.WriteString(w, `{"stop_reason":"end_turn","content":[{"type":"text","text":"Your agents spent 1200 µLXC. The payment to Mike waits for your approval."}]}`)
	default:
		http.Error(w, `{"error":"not a route Taly uses"}`, http.StatusNotFound)
	}
}

func talyApp(t *testing.T) (*app, *fakeLensForTaly, string, string) {
	t.Helper()
	a, _ := oauthApp(t)
	lens := &fakeLensForTaly{}
	srv := httptest.NewServer(lens)
	t.Cleanup(srv.Close)
	a.cfg.lensBaseURL = srv.URL
	ada := seedOAuthToken(a)
	a.oauth.grants.update("g-seed", func(g oauthGrant) oauthGrant {
		g.Scope, g.Who.lensToken = "wallets:read payments:prepare", "jwt-ada"
		return g
	})
	a.oauth.grants.put("g-bob", oauthGrant{ID: "g-bob", ClientID: "c-desk", ClientName: "Talyvor desktop", Scope: "wallets:read",
		Who: oauthWho{sub: "sub-bob", workspaceID: "ws-bob", lensToken: "jwt-bob"}, expires: time.Now().Add(time.Hour), endsAt: time.Now().Add(time.Hour)})
	a.oauth.access.put(tokenKey("tlv_oat_bob"), oauthToken{grantID: "g-bob", expires: time.Now().Add(time.Hour)})
	return a, lens, ada, "tlv_oat_bob"
}

// TestMCPTalyForTheDesktopApp is B45.41's DONE: on a Connect token, ask_taly runs Chat's tools through Lens and never pays,
// list_approvals lists the requests waiting with their approval links, and transcribe returns the words — each for the
// token's own workspace, on its own credential.
func TestMCPTalyForTheDesktopApp(t *testing.T) {
	a, lens, ada, bob := talyApp(t)

	// ask_taly: Chat's read tool and its prepare tool run, as this assistant; the tool Chat may not use does not.
	r := toolCall(t, a, ada, "ask_taly", map[string]any{"message": "What did my agents spend, and pay Mike £50",
		"thread": []any{map[string]any{"role": "user", "content": "Hi"}, map[string]any{"role": "assistant", "content": "Hello"}}})
	out, _ := r["structuredContent"].(map[string]any)
	if r["isError"] != false || out["approval_url"] != "https://app.talyvor.com/approve/pr-9" || !strings.Contains(out["reply"].(string), "waits for your approval") {
		t.Fatalf("ask_taly: %v", r)
	}
	if len(lens.called) != 2 || lens.called[0]["name"] != "wallet_agents_spend" || lens.called[1]["name"] != "prepare_payment" {
		t.Fatalf("Lens's tools called: %v, want Chat's two and never wallet_send", lens.called)
	}
	prep := lens.called[1]["arguments"].(map[string]any)
	if prep["client"] != "mcp:c-seed" || prep["idempotency_key"] == "mine" || prep["payee_id"] != "py-mike" {
		t.Fatalf("prepare_payment went up as %v: the client and key are Talyvor's, never the model's", prep)
	}
	var first struct {
		Model    string            `json:"model"`
		System   string            `json:"system"`
		Messages []json.RawMessage `json:"messages"`
		Tools    []struct {
			Name        string         `json:"name"`
			InputSchema map[string]any `json:"input_schema"`
		} `json:"tools"`
	}
	_ = json.Unmarshal(lens.asked[0], &first)
	if first.Model != "claude-new" || !strings.HasPrefix(first.System, "You are Taly") || len(first.Messages) != 3 || len(first.Tools) != 2 {
		t.Fatalf("the model was asked %s", lens.asked[0])
	}
	if props := first.Tools[1].InputSchema["properties"].(map[string]any); props["client"] != nil || props["idempotency_key"] != nil {
		t.Fatalf("the model was offered Talyvor's own arguments: %v", props)
	}
	if len(lens.asked) != 2 || !strings.Contains(string(lens.asked[1]), `"tool_use_id":"tu-3"`) || !strings.Contains(string(lens.asked[1]), "Taly may not use wallet_send") {
		t.Fatalf("the second round: %s", lens.asked[len(lens.asked)-1])
	}
	for _, c := range lens.calls {
		f := strings.Fields(c)
		if f[2] != "Bearer" || f[3] != "jwt-ada" && f[3] != "sk-ada" {
			t.Fatalf("ada's question reached Lens as %q", c)
		}
		if f[1] == "/v1/proxy/anthropic/v1/messages" && (f[3] != "sk-ada" || len(f) < 5 || f[4] != chatFeature) {
			t.Fatalf("Taly is asked on the chat key and billed as Chat's: %q", c)
		}
		if strings.Contains(f[1], "/approve") || strings.Contains(f[1], "/pay") {
			t.Fatalf("ask_taly called %s", c)
		}
	}

	// On a connection without payments:prepare, Taly is offered no prepare tool, and ask_taly is listed as reading.
	lens.asked, lens.called = nil, nil
	if r := toolCall(t, a, bob, "ask_taly", map[string]any{"message": "pay Mike"}); r["isError"] != false || r["structuredContent"].(map[string]any)["approval_url"] != nil {
		t.Fatalf("ask_taly read-only: %v", r)
	}
	if len(lens.called) != 1 || strings.Contains(string(lens.asked[0]), `"prepare_payment"`) {
		t.Fatalf("a read-only connection's Taly prepared: %v; offered %s", lens.called, lens.asked[0])
	}
	for _, tl := range rpc(t, a, bob, "tools/list", nil)["tools"].([]any) {
		if tool := tl.(map[string]any); tool["name"] == "ask_taly" && tool["annotations"].(map[string]any)["readOnlyHint"] != true {
			t.Fatalf("ask_taly on a read-only connection is listed as %v", tool["annotations"])
		}
	}

	// list_approvals: the token's own workspace's requests, newest first, with their links.
	ap := toolCall(t, a, bob, "list_approvals", nil)["structuredContent"].(map[string]any)["approvals"].([]any)
	newest := ap[0].(map[string]any)
	if len(ap) != 2 || newest["id"] != "pr-bob-new" || newest["title"] != "ACME Ltd" || newest["amount_minor"] != float64(4200) ||
		newest["currency"] != "USD" || newest["approval_url"] != "https://app.talyvor.com/approve/pr-bob-new" {
		t.Fatalf("list_approvals for bob: %v", ap)
	}

	// transcribe: the recording reaches Lens's transcription as Chat's microphone sends it, on the token's chat key.
	before := len(lens.calls)
	tr := toolCall(t, a, bob, "transcribe", map[string]any{"audio_base64": "UklGRg==", "mime": "audio/wav"})
	if tr["isError"] != false || tr["structuredContent"].(map[string]any)["text"] != "pay mike fifty pounds for bob" || lens.audio != "RIFF audio/wav" {
		t.Fatalf("transcribe: %v; Lens heard %q", tr, lens.audio)
	}
	if c := lens.calls[len(lens.calls)-1]; c != "POST /v1/audio/transcriptions Bearer sk-bob "+chatFeature || len(lens.calls) > before+2 {
		t.Fatalf("transcribe reached Lens as %v", lens.calls[before:])
	}
	if r := toolCall(t, a, bob, "transcribe", map[string]any{"audio_base64": "not base64!", "mime": "audio/wav"}); r["isError"] != true {
		t.Fatalf("a recording that is not base64: %v", r)
	}
}
