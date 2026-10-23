package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeLensForMCP answers the routes the MCP tools call, and records every request.
type fakeLensForMCP struct {
	mu    sync.Mutex
	calls []string // "METHOD /path Bearer … Idempotency-Key"
	sent  map[string]map[string]any
}

func (f *fakeLensForMCP) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	f.mu.Lock()
	f.calls = append(f.calls, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization")+" "+r.Header.Get("Idempotency-Key"))
	f.sent[r.Method+" "+r.URL.Path] = body
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch r.Method + " " + r.URL.Path {
	case "POST /v1/provision":
		_, _ = io.WriteString(w, `{"workspace_id":"ws-other","token":"jwt-other","expires_at":"2099-01-01T00:00:00Z"}`)
	case "GET /v1/money/accounts":
		_, _ = io.WriteString(w, `{"accounts":[{"id":"acc-gbp","currency":"GBP","test_minor":125000}]}`)
	case "POST /v1/money/invoices":
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"id":"inv-1","status":"draft","total_minor":12000,"currency":"GBP"}`)
	case "POST /v1/money/payment-requests":
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"id":"pr-1","status":"pending_approval","client":"`+body["client"].(string)+`",`+
			`"approval_url":"https://app.talyvor.com/approve/pr-1","deep_link":"talyvor://approve/pr-1","items":[{},{}]}`)
	case "GET /v1/money/payment-requests/pr-1":
		_, _ = io.WriteString(w, `{"id":"pr-1","status":"pending_approval","approval_url":"https://app.talyvor.com/approve/pr-1","deep_link":"talyvor://approve/pr-1"}`)
	default:
		_, _ = io.WriteString(w, `{}`)
	}
}

func mcpApp(t *testing.T) (*app, *fakeLensForMCP, *http.Cookie) {
	t.Helper()
	a, ck := oauthApp(t)
	lens := &fakeLensForMCP{sent: map[string]map[string]any{}}
	srv := httptest.NewServer(lens)
	t.Cleanup(srv.Close)
	a.cfg.lensBaseURL = srv.URL
	return a, lens, ck
}

// rpc posts one JSON-RPC message to /mcp on token and returns its result (or error) object.
func rpc(t *testing.T, a *app, token, method string, params any) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 7, "method": method, "params": params})
	rec := serve(a, "POST", "/mcp", "", string(body), map[string]string{"Authorization": "Bearer " + token, "MCP-Protocol-Version": "2025-06-18"}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: %d %s", method, rec.Code, rec.Body.String())
	}
	m := jsonOf(t, rec)
	if m["error"] != nil {
		return m["error"].(map[string]any)
	}
	return m["result"].(map[string]any)
}

func toolCall(t *testing.T, a *app, token, name string, args map[string]any) map[string]any {
	t.Helper()
	return rpc(t, a, token, "tools/call", map[string]any{"name": name, "arguments": args})
}

// TestMCPPreparesAndNeverPays is B40.7's DONE: with a token from the consent flow, an MCP client lists the tools with
// their annotations, reads a balance, drafts an invoice and prepares a two-bill batch that stays pending approval — every
// call on the person's own Lens credential, and none to a route that moves money.
func TestMCPPreparesAndNeverPays(t *testing.T) {
	a, lens, ck := mcpApp(t)
	client := jsonOf(t, serve(a, "POST", "/oauth/register", "", `{"client_name":"Claude","redirect_uris":["`+claudeReturn+`"]}`, nil, nil))
	token := connect(t, a, ck, client["client_id"].(string))["access_token"].(string)

	init := rpc(t, a, token, "initialize", map[string]any{"protocolVersion": "2025-06-18"})
	if init["protocolVersion"] != "2025-06-18" || init["serverInfo"].(map[string]any)["name"] != "talyvor" {
		t.Fatalf("initialize: %v", init)
	}

	tools := map[string]map[string]any{}
	for _, tl := range rpc(t, a, token, "tools/list", nil)["tools"].([]any) {
		tool := tl.(map[string]any)
		tools[tool["name"].(string)] = tool["annotations"].(map[string]any)
	}
	for name, want := range map[string][2]bool{ // readOnlyHint, destructiveHint
		"get_balances": {true, false}, "list_payees": {true, false}, "get_request_status": {true, false},
		"draft_invoice": {false, false}, "send_invoice": {false, true}, "prepare_batch": {false, true}, "cancel_request": {false, true},
	} {
		if ann, ok := tools[name]; !ok || ann["readOnlyHint"] != want[0] || ann["destructiveHint"] != want[1] {
			t.Fatalf("%s is listed with %v, want readOnlyHint %v destructiveHint %v", name, ann, want[0], want[1])
		}
	}
	if len(tools) != len(mcpTools) {
		t.Fatalf("a token with every scope lists %d tools, want all %d", len(tools), len(mcpTools))
	}

	bal := toolCall(t, a, token, "get_balances", nil)
	if bal["isError"] != false || !strings.Contains(bal["content"].([]any)[0].(map[string]any)["text"].(string), "125000") {
		t.Fatalf("get_balances: %v", bal)
	}

	inv := toolCall(t, a, token, "draft_invoice", map[string]any{"account_id": "acc-gbp", "customer_name": "Acme Ltd", "due_date": "2026-11-30",
		"lines": []any{map[string]any{"description": "Research", "quantity": 2, "unit_amount_minor": 5000, "vat_rate_bps": 2000}}, "send": true})
	if inv["isError"] != false || inv["structuredContent"].(map[string]any)["status"] != "draft" || lens.sent["POST /v1/money/invoices"]["send"] != false {
		t.Fatalf("draft_invoice: %v, sent up %v", inv, lens.sent["POST /v1/money/invoices"])
	}

	items := []any{map[string]any{"payee_id": "py-1", "currency": "GBP", "amount_minor": 4200, "reference": "INV-1"},
		map[string]any{"payee_id": "py-2", "currency": "GBP", "amount_minor": 9900, "reference": "INV-2"}}
	if r := toolCall(t, a, token, "prepare_batch", map[string]any{"items": items}); r["isError"] != true {
		t.Fatalf("a batch with no idempotency_key was sent up: %v", r)
	}
	batch := toolCall(t, a, token, "prepare_batch", map[string]any{"idempotency_key": "k-1", "items": items})
	out := batch["structuredContent"].(map[string]any)
	content := batch["content"].([]any)
	if batch["isError"] != false || out["status"] != "pending_approval" || !strings.HasPrefix(out["client"].(string), "mcp:tlv_oc_") ||
		!strings.Contains(content[0].(map[string]any)["text"].(string), "Nothing has been paid") ||
		content[len(content)-1].(map[string]any)["uri"] != "https://app.talyvor.com/approve/pr-1" {
		t.Fatalf("prepare_batch: %v", batch)
	}
	if sent := lens.sent["POST /v1/money/payment-requests"]; len(sent["items"].([]any)) != 2 {
		t.Fatalf("the batch went up as %v", sent)
	}
	if st := toolCall(t, a, token, "get_request_status", map[string]any{"request_id": "pr-1"}); st["structuredContent"].(map[string]any)["status"] != "pending_approval" {
		t.Fatalf("get_request_status: %v", st)
	}

	// Every call went up on the person's own credential, and none to a route that pays.
	pays := regexp.MustCompile(`/(approve|approval|pay|payments|payouts|transfers|licences|use|cash-outs)(/|$| )`)
	for _, c := range lens.calls {
		if !strings.Contains(c, " Bearer jwt-for-ws-ada") || pays.MatchString(c) {
			t.Fatalf("a tool called Lens with %q", c)
		}
	}
	if !strings.HasSuffix(lens.calls[len(lens.calls)-2], " k-1") {
		t.Fatalf("the batch went up without its Idempotency-Key: %q", lens.calls[len(lens.calls)-2])
	}
}

// TestMCPNoToolMovesMoney calls every tool and holds each Lens route it reaches to one that cannot pay.
func TestMCPNoToolMovesMoney(t *testing.T) {
	a, lens, _ := mcpApp(t)
	token := seedOAuthToken(a)
	a.oauth.grants.update("g-seed", func(g oauthGrant) oauthGrant {
		g.Scope = strings.Join(oauthScopeNames(), " ")
		g.Who.lensToken = "jwt-for-ws-ada"
		return g
	})
	args := map[string]any{"idempotency_key": "k", "payee_id": "py-1", "currency": "GBP", "amount_minor": 1, "listing_id": "l-1",
		"request_id": "pr-1", "invoice_id": "inv-1", "items": []any{map[string]any{"payee_id": "py-1"}}}
	allowed := map[string]bool{}
	for _, r := range []string{"GET /v1/money/accounts", "GET /v1/workspaces/ws-ada/agents", "GET /v1/money/payees",
		"GET /v1/money/permission-mandates", "GET /v1/marketplace/search", "GET /v1/marketplace/listings/l-1",
		"GET /v1/money/payment-requests/pr-1", "POST /v1/money/invoices", "POST /v1/money/invoices/inv-1/send",
		"POST /v1/money/payment-requests", "POST /v1/money/payment-requests/pr-1/cancel"} {
		allowed[r] = true
	}
	for _, tool := range mcpTools {
		if len(tool.name) > 64 || tool.description == "" {
			t.Fatalf("%s: a name of at most 64 characters and a description", tool.name)
		}
		before := len(lens.calls)
		if r := toolCall(t, a, token, tool.name, args); r["isError"] != false {
			t.Fatalf("%s: %v", tool.name, r)
		}
		if len(lens.calls) != before+1 {
			t.Fatalf("%s made %d Lens calls, want one", tool.name, len(lens.calls)-before)
		}
		f := strings.Fields(lens.calls[before])
		if !allowed[f[0]+" "+f[1]] {
			t.Fatalf("%s called %s %s, which is not one of the routes that prepare and never pay", tool.name, f[0], f[1])
		}
	}
}

// TestMCPToolsFollowTheGrantsScopes: a connection allowed only to read lists only the read tools and is refused the rest.
func TestMCPToolsFollowTheGrantsScopes(t *testing.T) {
	a, lens, _ := mcpApp(t)
	token := seedOAuthToken(a) // wallets:read only
	for _, tl := range rpc(t, a, token, "tools/list", nil)["tools"].([]any) {
		if tl.(map[string]any)["annotations"].(map[string]any)["readOnlyHint"] != true {
			t.Fatalf("a read-only connection lists %v", tl)
		}
	}
	r := toolCall(t, a, token, "prepare_payment", map[string]any{"idempotency_key": "k", "payee_id": "py-1", "currency": "GBP", "amount_minor": 100})
	if r["isError"] != true || !strings.Contains(r["content"].([]any)[0].(map[string]any)["text"].(string), "payments:prepare") || len(lens.calls) != 0 {
		t.Fatalf("prepare_payment on a read-only connection: %v, Lens saw %v", r, lens.calls)
	}
	if e := toolCall(t, a, token, "pay_now", nil); e["code"] != float64(mcpErrInvalidParam) {
		t.Fatalf("an unknown tool: %v", e)
	}
}

// TestMCPRefusesAWorkspaceOtherThanTheConsentedOne: a grant whose Lens credential has expired is re-minted by
// provisioning, and if provisioning names another workspace the tool is refused and nothing reaches Lens's tools.
func TestMCPRefusesAWorkspaceOtherThanTheConsentedOne(t *testing.T) {
	a, lens, _ := mcpApp(t)
	token := seedOAuthToken(a)
	a.oauth.grants.update("g-seed", func(g oauthGrant) oauthGrant {
		g.Who.lensToken, g.Who.lensTokenExp = "jwt-expired", time.Now().Add(-time.Minute)
		return g
	})
	r := toolCall(t, a, token, "get_balances", nil)
	if r["isError"] != true {
		t.Fatalf("a grant re-minted into another workspace was served: %v", r)
	}
	for _, c := range lens.calls {
		if !strings.HasPrefix(c, "POST /v1/provision ") {
			t.Fatalf("Lens was asked %q for a grant whose workspace could not be confirmed", c)
		}
	}
}
