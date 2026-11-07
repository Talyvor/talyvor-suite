package main

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

// agentsApp is mcpApp with a connection granted every scope, its Lens credential in hand, and the BFF holding Lens's
// Connect mint key.
func agentsApp(t *testing.T) (*app, *fakeLensForMCP, string) {
	t.Helper()
	a, lens, _ := mcpApp(t)
	a.cfg.lensConnectMintKey = "mint-key"
	token := seedOAuthToken(a)
	a.oauth.grants.update("g-seed", func(g oauthGrant) oauthGrant {
		g.Scope, g.ClientName = strings.Join(oauthScopeNames(), " "), "Claude"
		g.Who.lensToken = "jwt-for-ws-ada"
		return g
	})
	return a, lens, token
}

func (f *fakeLensForMCP) count(prefix string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			n++
		}
	}
	return n
}

func structured(r map[string]any) map[string]any {
	m, _ := r["structuredContent"].(map[string]any)
	return m
}

func text(r map[string]any) string {
	var out []string
	for _, c := range r["content"].([]any) {
		if s, ok := c.(map[string]any)["text"].(string); ok {
			out = append(out, s)
		}
	}
	return strings.Join(out, "\n")
}

// TestConnectSendPayment is B52.6's payment: inside the agent's limits it pays once on a Connect token minted for that
// agent alone; above them Lens files an approval, nothing is paid and the assistant is given the link; with the
// prepare-only setting on, or without the mint key, nothing is minted and nothing is paid.
func TestConnectSendPayment(t *testing.T) {
	a, lens, token := agentsApp(t)
	pay := map[string]any{"agent_id": "agt-1", "to_agent_id": "agt-2", "amount_ulxc": 400, "memo": "GPU hour", "idempotency_key": "k-1"}

	r := toolCall(t, a, token, "send_payment", pay)
	if r["isError"] != false || structured(r)["status"] != "paid" {
		t.Fatalf("inside the limits: %v", r)
	}
	if got := lens.count("POST /v1/workspaces/ws-ada/agents/agt-1/pay Bearer jwt-connect k-1"); got != 1 {
		t.Fatalf("the payment must go once on the Connect token with the idempotency key; calls %v", lens.calls)
	}
	mint := lens.sent["POST /v1/auth/connect-token"]
	if mint["workspace_id"] != "ws-ada" || mint["user_id"] != "ws-ada" || mint["client_id"] != "c-seed" || mint["agent_id"] != "agt-1" ||
		len(mint["scopes"].([]any)) != 1 || mint["scopes"].([]any)[0] != "payments:send" {
		t.Fatalf("the Connect token must be for this person, this assistant and this agent only, to pay: %v", mint)
	}
	if memo := lens.sent["POST /v1/workspaces/ws-ada/agents/agt-1/pay"]["memo"]; memo != "GPU hour (asked by Claude)" {
		t.Fatalf("the payment must name the assistant that asked: memo %q", memo)
	}

	pay["amount_ulxc"], pay["idempotency_key"] = 5000, "k-2"
	r = toolCall(t, a, token, "send_payment", pay)
	if s := structured(r); r["isError"] != false || s["status"] != "pending_approval" || s["approval_id"] != "apr-1" ||
		s["approval_url"] != oauthOrigin+"/approvals" || !strings.Contains(text(r), "Nothing has been paid") {
		t.Fatalf("above the limits the assistant is told it waits for approval, with the link: %v", r)
	}

	a.cfg.connectPrepareOnly = true
	before := len(lens.calls)
	pay["amount_ulxc"], pay["idempotency_key"] = 400, "k-3"
	if r = toolCall(t, a, token, "send_payment", pay); r["isError"] != true || !strings.Contains(text(r), "Nothing has been paid") {
		t.Fatalf("prepare-only: %v", r)
	}
	if len(lens.calls) != before {
		t.Fatalf("prepare-only must reach no Lens route: %v", lens.calls[before:])
	}

	a.cfg.connectPrepareOnly, a.cfg.lensConnectMintKey = false, ""
	if r = toolCall(t, a, token, "send_payment", pay); r["isError"] != true || len(lens.calls) != before {
		t.Fatalf("without the mint key nothing is minted or paid: %v %v", r, lens.calls[before:])
	}
}

// TestConnectSendPaymentNeedsItsScope: a connection without payments:send is refused before anything reaches Lens.
func TestConnectSendPaymentNeedsItsScope(t *testing.T) {
	a, lens, token := agentsApp(t)
	a.oauth.grants.update("g-seed", func(g oauthGrant) oauthGrant { g.Scope = "wallets:read payments:prepare"; return g })
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"send_payment","arguments":{"agent_id":"agt-1","to_agent_id":"agt-2","amount_ulxc":1,"idempotency_key":"k"}}}`
	rec := serve(a, "POST", "/mcp", "", body, map[string]string{"Authorization": "Bearer " + token}, nil)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Header().Get("WWW-Authenticate"), "payments:send") || len(lens.calls) != 0 {
		t.Fatalf("send_payment without payments:send: %d %q, Lens calls %v", rec.Code, rec.Header().Get("WWW-Authenticate"), lens.calls)
	}
}

// TestConnectCreateAgentUnderTheCeiling: create_agent is refused until the person sets the ceiling in the app, and
// above it; under it the agent is made, described and given exactly those limits.
func TestConnectCreateAgentUnderTheCeiling(t *testing.T) {
	a, lens, token := agentsApp(t)
	ck := &http.Cookie{Name: sessionCookieName, Value: "sid-ada"} // agentsApp's person
	args := map[string]any{"name": "Research buyer", "purpose": "Buys datasets", "max_per_request_ulxc": 1000, "daily_limit_ulxc": 5000, "monthly_limit_ulxc": 20000}

	if r := toolCall(t, a, token, "create_agent", args); r["isError"] != true || !strings.Contains(text(r), "/settings/connect") || len(lens.calls) != 0 {
		t.Fatalf("with no ceiling set: %v, Lens calls %v", r, lens.calls)
	}
	ceiling := `{"max_per_request_ulxc":1000,"daily_limit_ulxc":5000,"monthly_limit_ulxc":10000}`
	if rec := serve(a, "PUT", "/api/connect/agent-ceiling", "https://evil.example", ceiling, nil, ck); rec.Code != http.StatusForbidden {
		t.Fatalf("another site sets the ceiling: %d %s", rec.Code, rec.Body.String())
	}
	if rec := serve(a, "PUT", "/api/connect/agent-ceiling", oauthOrigin, `{"max_per_request_ulxc":1000,"daily_limit_ulxc":5000,"monthly_limit_ulxc":10000}`, nil, ck); rec.Code != http.StatusOK {
		t.Fatalf("setting the ceiling: %d %s", rec.Code, rec.Body.String())
	}
	if got := jsonOf(t, serve(a, "GET", "/api/connect/agent-ceiling", "", "", nil, ck)); got["monthly_limit_ulxc"] != float64(10000) {
		t.Fatalf("the ceiling reads back: %v", got)
	}
	if r := toolCall(t, a, token, "create_agent", args); r["isError"] != true || !strings.Contains(text(r), "monthly_limit_ulxc") || len(lens.calls) != 0 {
		t.Fatalf("a monthly limit above the ceiling: %v, Lens calls %v", r, lens.calls)
	}

	args["monthly_limit_ulxc"] = 10000
	r := toolCall(t, a, token, "create_agent", args)
	if r["isError"] != false || structured(r)["id"] != "agt-new" {
		t.Fatalf("under the ceiling: %v", r)
	}
	if lens.sent["POST /v1/workspaces/ws-ada/agents"]["name"] != "Research buyer" ||
		lens.sent["PATCH /v1/workspaces/ws-ada/agents/agt-new"]["description"] != "Buys datasets" {
		t.Fatalf("the agent's name and purpose: %v", lens.sent)
	}
	rules := lens.sent["PUT /v1/workspaces/ws-ada/agents/agt-new/rules"]
	if rules["max_per_request_ulxc"] != float64(1000) || rules["daily_limit_ulxc"] != float64(5000) || rules["monthly_limit_ulxc"] != float64(10000) {
		t.Fatalf("the agent's starting limits: %v", rules)
	}
}

// TestConnectSetAgentLimits: a lower limit applies at once, every other rule kept; a higher one, or none at all, is not
// applied and waits for the person in Talyvor.
func TestConnectSetAgentLimits(t *testing.T) {
	a, lens, token := agentsApp(t)
	r := toolCall(t, a, token, "set_agent_limits", map[string]any{"agent_id": "agt-1", "max_per_request_ulxc": 200, "daily_limit_ulxc": 9000, "monthly_limit_ulxc": 0})
	if r["isError"] != false {
		t.Fatalf("set_agent_limits: %v", r)
	}
	rules := lens.sent["PUT /v1/workspaces/ws-ada/agents/agt-1/rules"]
	if rules["max_per_request_ulxc"] != float64(200) || rules["daily_limit_ulxc"] != float64(2000) || rules["monthly_limit_ulxc"] != float64(0) ||
		rules["approval_above_ulxc"] != float64(300) || len(rules["allowed_models"].([]any)) != 1 {
		t.Fatalf("only the lower limit changes, every other rule kept: %v", rules)
	}
	s := structured(r)
	waiting, _ := s["waiting"].(map[string]any)
	if s["applied"].(map[string]any)["max_per_request_ulxc"] != float64(200) || waiting["daily_limit_ulxc"] != float64(9000) ||
		!strings.Contains(text(r), oauthOrigin+"/agents") {
		t.Fatalf("the raise waits for the person: %v", r)
	}

	before := lens.count("PUT ")
	if r = toolCall(t, a, token, "set_agent_limits", map[string]any{"agent_id": "agt-1", "daily_limit_ulxc": 0}); r["isError"] != false || lens.count("PUT ") != before {
		t.Fatalf("removing a limit is a raise and saves nothing: %v", r)
	}
}

// rulesTheBFFDoesNotName are rules Lens keeps that no limit tool names, and one it may add later.
const rulesTheBFFDoesNotName = `"payee_allowances":{"agt-2":{"daily_ulxc":50}},"max_commitment_ulxc":7000,` +
	`"allowed_licences":["cc-by"],"may_subscribe":true,"rule_from_tomorrow":{"x":[1]}`

// TestConnectLimitsKeepEveryOtherRule: lowering a limit from the chat, or giving a new agent its first ones, sends every
// rule the BFF does not name back to Lens as it read it, so no commitment cap, licence or always-allowed payee is erased.
func TestConnectLimitsKeepEveryOtherRule(t *testing.T) {
	var want map[string]any
	if err := json.Unmarshal([]byte("{"+rulesTheBFFDoesNotName+"}"), &want); err != nil {
		t.Fatal(err)
	}
	a, lens, token := agentsApp(t)
	a.oauth.ceilings.Store("ws-ada", connectCeiling{MaxPerRequestULXC: 1000, DailyLimitULXC: 5000, MonthlyLimitULXC: 10000})
	if r := toolCall(t, a, token, "set_agent_limits", map[string]any{"agent_id": "agt-1", "daily_limit_ulxc": 1500}); r["isError"] != false {
		t.Fatalf("set_agent_limits: %v", r)
	}
	if r := toolCall(t, a, token, "create_agent", map[string]any{"name": "Buyer", "purpose": "Buys", "max_per_request_ulxc": 100,
		"daily_limit_ulxc": 200, "monthly_limit_ulxc": 300}); r["isError"] != false {
		t.Fatalf("create_agent: %v", r)
	}
	for _, put := range []string{"PUT /v1/workspaces/ws-ada/agents/agt-1/rules", "PUT /v1/workspaces/ws-ada/agents/agt-new/rules"} {
		for k, v := range want {
			if got := lens.sent[put][k]; !reflect.DeepEqual(got, v) {
				t.Errorf("%s: %s sent as %v, Lens holds %v", put, k, got, v)
			}
		}
	}
}

// TestConnectAgentReadsAndTopUp: pause, the statement, the requests waiting on the person's agents, and the top-up link,
// which charges nothing and reaches no Lens route.
func TestConnectAgentReadsAndTopUp(t *testing.T) {
	a, lens, token := agentsApp(t)
	if r := toolCall(t, a, token, "pause_agent", map[string]any{"agent_id": "agt-1", "reason": "over budget"}); r["isError"] != false ||
		lens.sent["POST /v1/workspaces/ws-ada/agents/agt-1/pause"]["reason"] != "Paused by Claude: over budget" {
		t.Fatalf("pause_agent: %v %v", r, lens.sent)
	}
	if r := toolCall(t, a, token, "get_statement", map[string]any{"agent_id": "agt-1"}); r["isError"] != false || structured(r)["agent_id"] != "agt-1" {
		t.Fatalf("get_statement: %v", r)
	}
	r := toolCall(t, a, token, "list_incoming_requests", nil)
	reqs, _ := structured(r)["requests"].([]any)
	if r["isError"] != false || len(reqs) != 1 || reqs[0].(map[string]any)["id"] != "mr-in" {
		t.Fatalf("only the pending requests made of the person's agents: %v", r)
	}
	before := len(lens.calls)
	if r = toolCall(t, a, token, "open_topup", nil); r["isError"] != false || structured(r)["url"] != oauthOrigin+"/billing" || len(lens.calls) != before {
		t.Fatalf("open_topup: %v", r)
	}

	listed := rpc(t, a, token, "tools/list", nil)["tools"].([]any)
	hints := map[string]map[string]any{}
	for _, x := range listed {
		hints[x.(map[string]any)["name"].(string)] = x.(map[string]any)["annotations"].(map[string]any)
	}
	if hints["send_payment"]["destructiveHint"] != true || hints["open_topup"]["readOnlyHint"] != true || hints["create_agent"]["readOnlyHint"] != false {
		t.Fatalf("annotations: %v", hints)
	}
}
