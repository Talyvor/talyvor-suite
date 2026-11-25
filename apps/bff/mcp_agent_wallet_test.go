package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
)

// fakeLensAgentMCP is Lens's /mcp as an agent's own key reaches it (talyvor-lens internal/mcp, B48.16): it answers only
// agentKey, lists the wallet tools among its others, and records every message it was sent.
type fakeLensAgentMCP struct {
	mu   sync.Mutex
	sent []map[string]any
}

const (
	testAgentKey    = "tlv_" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	lensWalletsText = `{"agent_id":"agt-1","wallets":[{"asset":"GBP","balance_minor":4200},{"asset":"USDC","balance_minor":15000000}]}`
	lensTopUpText   = `{"move_id":"wm-1","status":"quoted","method":"card","pay_minor":10000,"currency":"EUR","usdc_minor":106700000,` +
		`"link":"https://app.talyvor.com/agents/agt-1?top_up=wm-1","confirm":"/v1/workspaces/ws-1/agents/agt-1/wallet-moves/wm-1/confirm"}`
)

func (f *fakeLensAgentMCP) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method+" "+r.URL.Path != "POST /mcp" || r.Header.Get("Authorization") != "Bearer "+testAgentKey {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":"invalid API key"}`)
		return
	}
	var msg map[string]any
	_ = json.NewDecoder(r.Body).Decode(&msg)
	f.mu.Lock()
	f.sent = append(f.sent, msg)
	f.mu.Unlock()
	answer := func(result any) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": msg["id"], "result": result})
	}
	params, _ := msg["params"].(map[string]any)
	switch msg["method"] {
	case "ping":
		answer(map[string]any{})
	case "tools/list":
		tool := func(name string) map[string]any {
			return map[string]any{"name": name, "description": "Lens's " + name, "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}}
		}
		answer(map[string]any{"tools": []any{tool("agent_pay"), tool("wallet_list"), tool("wallet_balance"), tool("wallet_receive_details"),
			tool("wallet_history"), tool("wallet_send"), tool("wallet_request"), tool("wallet_topup_link"), tool("wallet_pot_move"), tool("get_spend_summary")}})
	case "tools/call":
		if params["name"] == "wallet_list" {
			answer(map[string]any{"content": []any{map[string]any{"type": "text", "text": lensWalletsText}}})
			return
		}
		if params["name"] == "wallet_topup_link" {
			answer(map[string]any{"content": []any{map[string]any{"type": "text", "text": lensTopUpText}}})
			return
		}
		args, _ := params["arguments"].(map[string]any)
		text, _ := json.Marshal(map[string]any{"tool": params["name"], "status": "awaiting_owner", "network": args["network"]})
		answer(map[string]any{"content": []any{map[string]any{"type": "text", "text": string(text)}}})
	default:
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": msg["id"], "error": map[string]any{"code": -32601, "message": "method not found"}})
	}
}

func agentMCPApp(t *testing.T) (*app, *fakeLensAgentMCP) {
	t.Helper()
	a, _ := oauthApp(t)
	lens := &fakeLensAgentMCP{}
	srv := httptest.NewServer(lens)
	t.Cleanup(srv.Close)
	a.cfg.lensBaseURL = srv.URL
	return a, lens
}

// TestMCPAgentKeyReachesLensWalletTools is B48.41's DONE: on app.talyvor.com/mcp an agent's own key is offered B48.16's
// wallet tools, each call passed to Lens's /mcp on that key; wallet_list answers what Lens answers, a send or request
// that names no network never reaches Lens, and a key Lens does not know is refused as an unknown token.
func TestMCPAgentKeyReachesLensWalletTools(t *testing.T) {
	a, lens := agentMCPApp(t)

	init := rpc(t, a, testAgentKey, "initialize", map[string]any{"protocolVersion": "2025-06-18"})
	if init["protocolVersion"] != "2025-06-18" || init["serverInfo"].(map[string]any)["name"] != "talyvor" {
		t.Fatalf("initialize: %v", init)
	}

	var names []string
	for _, tl := range rpc(t, a, testAgentKey, "tools/list", nil)["tools"].([]any) {
		tool := tl.(map[string]any)
		if tool["description"] != "Lens's "+tool["name"].(string) {
			t.Fatalf("%s is not described as Lens describes it: %v", tool["name"], tool)
		}
		names = append(names, tool["name"].(string))
	}
	slices.Sort(names)
	if want := []string{"wallet_balance", "wallet_history", "wallet_list", "wallet_receive_details", "wallet_request", "wallet_send", "wallet_topup_link"}; !slices.Equal(names, want) {
		t.Fatalf("an agent's key is offered %v, want %v", names, want)
	}

	list := toolCall(t, a, testAgentKey, "wallet_list", nil)
	if got := list["content"].([]any)[0].(map[string]any)["text"]; got != lensWalletsText {
		t.Fatalf("wallet_list answered %v, want Lens's %s", got, lensWalletsText)
	}

	before := len(lens.sent)
	if send := toolCall(t, a, testAgentKey, "wallet_send", map[string]any{"to": "0xabc", "amount_minor": 1000000, "idempotency_key": "k1"}); send["isError"] != true {
		t.Fatalf("a wallet_send naming no network was answered %v", send)
	}
	if pay := toolCall(t, a, testAgentKey, "agent_pay", map[string]any{"to_agent_id": "agt-2", "amount_ulxc": 5}); pay["code"] == nil {
		t.Fatalf("agent_pay, not a wallet tool, was answered %v", pay)
	}
	if len(lens.sent) != before {
		t.Fatalf("Lens was sent %v for calls this server refuses", lens.sent[before:])
	}

	send := toolCall(t, a, testAgentKey, "wallet_send", map[string]any{"to": "0xabc", "network": "base", "amount_minor": 1000000, "idempotency_key": "k2"})
	last := lens.sent[len(lens.sent)-1]
	if !strings.Contains(send["content"].([]any)[0].(map[string]any)["text"].(string), `"status":"awaiting_owner"`) ||
		!reflect.DeepEqual(last["params"], map[string]any{"name": "wallet_send",
			"arguments": map[string]any{"to": "0xabc", "network": "base", "amount_minor": float64(1000000), "idempotency_key": "k2"}}) {
		t.Fatalf("wallet_send on a network answered %v after sending Lens %v", send, last)
	}

	unknown := "tlv_" + strings.Repeat("f", 64)
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"wallet_list","arguments":{}}}`
	rec := serve(a, "POST", "/mcp", "", body, map[string]string{"Authorization": "Bearer " + unknown}, nil)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Header().Get("WWW-Authenticate"), `error="invalid_token"`) {
		t.Fatalf("a key Lens does not know: %d %q %s", rec.Code, rec.Header().Get("WWW-Authenticate"), rec.Body.String())
	}
}

// TestMCPAgentKeyAsksOwnerForTopUp is B48.46's DONE: on app.talyvor.com/mcp an agent's own key calls B48.39's
// wallet_topup_link, the call reaches Lens's /mcp on that key with its arguments unchanged, and the agent gets Lens's
// quote and link as Lens gave them. This server answers nothing about the top-up itself.
func TestMCPAgentKeyAsksOwnerForTopUp(t *testing.T) {
	a, lens := agentMCPApp(t)

	topUp := toolCall(t, a, testAgentKey, "wallet_topup_link", map[string]any{"amount_minor": 10000, "currency": "EUR", "method": "card"})
	content, _ := topUp["content"].([]any)
	if len(content) == 0 {
		t.Fatalf("wallet_topup_link answered %v, want Lens's %s", topUp, lensTopUpText)
	}
	if got := content[0].(map[string]any)["text"]; got != lensTopUpText {
		t.Fatalf("wallet_topup_link answered %v, want Lens's %s", topUp, lensTopUpText)
	}
	last := lens.sent[len(lens.sent)-1]
	if !reflect.DeepEqual(last["params"], map[string]any{"name": "wallet_topup_link",
		"arguments": map[string]any{"amount_minor": float64(10000), "currency": "EUR", "method": "card"}}) {
		t.Fatalf("Lens was sent %v for the agent's wallet_topup_link", last)
	}
}
