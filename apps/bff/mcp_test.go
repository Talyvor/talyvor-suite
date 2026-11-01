package main

import (
	"encoding/json"
	"fmt"
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
	case "GET /v1/money/payees":
		_, _ = io.WriteString(w, `{"payees":[{"id":"py-mj","name":"Mike Jones"},{"id":"py-ms","name":"Mike  Smith"},{"id":"py-mk","name":"Mikel Hart"},`+
			`{"id":"py-gh","name":"Grace Hopper"},{"id":"py-ak","name":"Alan Kay","needs_confirmation":true}]}`)
	case "POST /v1/money/payees":
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"id":"py-new","name":"`+body["name"].(string)+`","check":"exact_match"}`)
	case "POST /v1/money/permission-mandates/prepare":
		_, _ = io.WriteString(w, `{"canonical":"{\"id\":\"pm-1\"}","challenge":"ch-1","allow_credentials":["cred-1"]}`)
	case "POST /v1/money/permission-mandates":
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"id":"pm-1","status":"active"}`)
	case "POST /v1/money/bills/pay":
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"id":"pr-bills","status":"pending_approval","client":"`+body["client"].(string)+`",`+
			`"approval_url":"https://app.talyvor.com/approve/pr-bills","deep_link":"talyvor://approve/pr-bills","items":[{"bill_id":"bill-1"}]}`)
	case "GET /v1/money/bills":
		_, _ = io.WriteString(w, `{"bills":[{"id":"bill-1","supplier":"Northern Power","invoice_number":"NP-881","amount_minor":16550,"currency":"GBP",`+
			`"due_date":"2026-11-05","sort_code":"400000","account_number":"12345678","iban":"GB33BUKB20201555555555","payee_id":"py-np",`+
			`"payee_match":"matched","status":"due","missing":[]},{"id":"bill-0","supplier":"Old Co","amount_minor":900,"currency":"GBP","status":"paid","missing":[]}]}`)
	case "GET /v1/workspaces/ws-ada/agents/safe-to-spend":
		_, _ = io.WriteString(w, `{"company":[{"currency":"GBP","balance":125000,"scheduled":0,"bills_due":16550,"pending_approvals":0,"safe_to_spend":108450}],"agents":[]}`)
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
	args := map[string]any{"name": "Acme Ltd", "country": "GB", "iban": "GB33BUKB20201555555555", "expires_at": "2027-01-31T00:00:00Z",
		"scope": map[string]any{"payees": []any{"py-1"}, "currencies": []any{"GBP"}}, "new_payee": map[string]any{"policy": "always_ask"},
		"idempotency_key": "k", "payee_id": "py-1", "currency": "GBP", "amount_minor": 1, "listing_id": "l-1", "contact": "Grace",
		"request_id": "pr-1", "invoice_id": "inv-1", "items": []any{map[string]any{"payee_id": "py-1"}}}
	allowed := map[string]bool{}
	for _, r := range []string{"GET /v1/money/accounts", "GET /v1/workspaces/ws-ada/agents", "GET /v1/money/payees",
		"GET /v1/money/permission-mandates", "GET /v1/marketplace/search", "GET /v1/marketplace/listings/l-1",
		"GET /v1/money/payment-requests/pr-1", "POST /v1/money/invoices", "POST /v1/money/invoices/inv-1/send",
		"POST /v1/money/payment-requests", "POST /v1/money/payment-requests/pr-1/cancel", "POST /v1/money/permission-mandates/prepare",
		"GET /v1/money/bills", "GET /v1/workspaces/ws-ada/agents/safe-to-spend", "POST /v1/money/bills/pay", "GET /v1/money/payment-requests"} {
		allowed[r] = true
	}
	for _, tool := range mcpTools {
		if len(tool.name) > 64 || tool.description == "" {
			t.Fatalf("%s: a name of at most 64 characters and a description", tool.name)
		}
		if tool.run != nil {
			continue // Taly and the microphone: TestMCPTalyForTheDesktopApp holds them to routes that never pay
		}
		before := len(lens.calls)
		if r := toolCall(t, a, token, tool.name, args); r["isError"] != false {
			t.Fatalf("%s: %v", tool.name, r)
		}
		want := 1
		if tool.keeps == "payee" {
			want = 0 // only kept, for the person to save
		}
		if tool.resolve != nil {
			want = 2 // the read it resolves by, then its call
		}
		if len(lens.calls) != before+want {
			t.Fatalf("%s made %d Lens calls, want %d", tool.name, len(lens.calls)-before, want)
		}
		for _, c := range lens.calls[before:] {
			if f := strings.Fields(c); !allowed[f[0]+" "+f[1]] {
				t.Fatalf("%s called %s %s, which is not one of the routes that prepare and never pay", tool.name, f[0], f[1])
			}
		}
	}
}

// TestMCPPaymentToContact is B45.38's "Transfer $500 to Mike" on app.talyvor.com/mcp: two saved Mikes ask "Which Mike?"
// and prepare nothing, nor does an unconfirmed contact or a stranger; "grace" prepares one request to Grace Hopper's
// payee alone, whatever payee_id the assistant sent, and the contact's name never goes up as a field.
func TestMCPPaymentToContact(t *testing.T) {
	a, lens, _ := mcpApp(t)
	token := seedOAuthToken(a)
	a.oauth.grants.update("g-seed", func(g oauthGrant) oauthGrant {
		g.Scope = strings.Join(oauthScopeNames(), " ")
		g.Who.lensToken = "jwt-for-ws-ada"
		return g
	})
	prepared := func() int { return strings.Count(strings.Join(lens.calls, "\n"), "POST /v1/money/payment-requests ") }
	for contact, want := range map[string]string{"Mike": "Which Mike?", "alan": "Alan Kay is saved but not confirmed", "Mikel Jones": "No saved contact is called"} {
		r := toolCall(t, a, token, "prepare_payment_to_contact", map[string]any{"idempotency_key": "k-" + contact, "contact": contact, "currency": "USD", "amount_minor": 50000})
		q, _ := r["structuredContent"].(map[string]any)["question"].(string)
		if r["isError"] != false || !strings.HasPrefix(q, want) || prepared() != 0 {
			t.Fatalf("%q: %v, and %d requests prepared", contact, r, prepared())
		}
	}
	if r := toolCall(t, a, token, "prepare_payment_to_contact", map[string]any{"idempotency_key": "k-mike", "contact": "Mike", "currency": "USD", "amount_minor": 50000}); len(r["structuredContent"].(map[string]any)["contacts"].([]any)) != 2 {
		t.Fatalf("Which Mike? lists %v, want both Mikes", r["structuredContent"])
	}
	r := toolCall(t, a, token, "prepare_payment_to_contact", map[string]any{"idempotency_key": "k-grace", "contact": " grace ", "currency": "USD", "amount_minor": 50000, "payee_id": "py-mj"})
	items, _ := lens.sent["POST /v1/money/payment-requests"]["items"].([]any)
	if r["isError"] != false || r["structuredContent"].(map[string]any)["status"] != "pending_approval" || prepared() != 1 || len(items) != 1 {
		t.Fatalf("grace: %v, %d requests prepared, items %v", r, prepared(), items)
	}
	if it := items[0].(map[string]any); it["payee_id"] != "py-gh" || it["amount_minor"] != float64(50000) || it["currency"] != "USD" || it["contact"] != nil {
		t.Fatalf("grace's request went up as %v", it)
	}
}

// TestMCPBillsDueAndSafeToSpend is B40.36's DONE: a read-only connection reads a workspace's one bill due — never the bank
// details printed on it, nor a bill already paid — and its safe-to-spend figure, each from one Lens route on the person's
// own credential.
func TestMCPBillsDueAndSafeToSpend(t *testing.T) {
	a, lens, _ := mcpApp(t)
	token := seedOAuthToken(a) // wallets:read only
	a.oauth.grants.update("g-seed", func(g oauthGrant) oauthGrant {
		g.Who.lensToken = "jwt-for-ws-ada"
		return g
	})
	bills := toolCall(t, a, token, "bills_due", nil)
	text := bills["content"].([]any)[0].(map[string]any)["text"].(string)
	got := bills["structuredContent"].(map[string]any)
	list, _ := got["bills"].([]any)
	if bills["isError"] != false || got["count"] != float64(1) || len(list) != 1 || list[0].(map[string]any)["id"] != "bill-1" ||
		got["totals"].(map[string]any)["GBP"] != float64(16550) {
		t.Fatalf("bills_due: %v", bills)
	}
	for _, printed := range []string{"GB33BUKB", "12345678", "400000", "iban", "sort_code", "account_number", "Old Co"} {
		if strings.Contains(text, printed) {
			t.Fatalf("bills_due shows %q: %s", printed, text)
		}
	}
	safe := toolCall(t, a, token, "safe_to_spend", nil)
	if fig := safe["structuredContent"].(map[string]any)["company"].([]any); safe["isError"] != false || fig[0].(map[string]any)["safe_to_spend"] != float64(108450) {
		t.Fatalf("safe_to_spend: %v", safe)
	}
	want := []string{"GET /v1/money/bills Bearer jwt-for-ws-ada ", "GET /v1/workspaces/ws-ada/agents/safe-to-spend Bearer jwt-for-ws-ada "}
	if fmt.Sprint(lens.calls) != fmt.Sprint(want) {
		t.Fatalf("Lens saw %q, want %q", lens.calls, want)
	}
}

// TestMCPBillsPayment is B45.39: prepare_bills_payment with no bill_ids asks Lens for every bill due as one request, judged as
// this assistant and under its Idempotency-Key, and answers it pending approval with its link; named bills go up as named,
// and an empty list or no key goes nowhere.
func TestMCPBillsPayment(t *testing.T) {
	a, lens, _ := mcpApp(t)
	token := seedOAuthToken(a)
	a.oauth.grants.update("g-seed", func(g oauthGrant) oauthGrant {
		g.Scope = strings.Join(oauthScopeNames(), " ")
		g.Who.lensToken = "jwt-for-ws-ada"
		return g
	})
	for _, args := range []map[string]any{{"bill_ids": []any{"bill-1"}}, {"idempotency_key": "k-0", "bill_ids": []any{}}} {
		if r := toolCall(t, a, token, "prepare_bills_payment", args); r["isError"] != true || len(lens.calls) != 0 {
			t.Fatalf("%v went up: %v, Lens saw %v", args, r, lens.calls)
		}
	}
	all := toolCall(t, a, token, "prepare_bills_payment", map[string]any{"idempotency_key": "k-all"})
	content := all["content"].([]any)
	if all["isError"] != false || all["structuredContent"].(map[string]any)["status"] != "pending_approval" ||
		!strings.Contains(content[0].(map[string]any)["text"].(string), "Nothing has been paid") ||
		content[len(content)-1].(map[string]any)["uri"] != "https://app.talyvor.com/approve/pr-bills" {
		t.Fatalf("prepare_bills_payment: %v", all)
	}
	if sent := lens.sent["POST /v1/money/bills/pay"]; sent["bill_ids"] != nil || !strings.HasPrefix(sent["client"].(string), "mcp:") || len(sent) != 2 {
		t.Fatalf("every bill due went up as %v", sent)
	}
	toolCall(t, a, token, "prepare_bills_payment", map[string]any{"idempotency_key": "k-one", "bill_ids": []any{"bill-1"}})
	if sent := lens.sent["POST /v1/money/bills/pay"]; fmt.Sprint(sent["bill_ids"]) != "[bill-1]" {
		t.Fatalf("one bill went up as %v", sent)
	}
	if want := []string{"POST /v1/money/bills/pay Bearer jwt-for-ws-ada k-all", "POST /v1/money/bills/pay Bearer jwt-for-ws-ada k-one"}; fmt.Sprint(lens.calls) != fmt.Sprint(want) {
		t.Fatalf("Lens saw %q, want %q", lens.calls, want)
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

// TestMCPPayeeAndMandateWaitForThePerson is B40.35's DONE: an assistant's create_payee_request appears on the Pay screen
// and is a payee only after the person saves it; its draft_mandate appears for signing and is a mandate only after the
// passkey signs it — and covers only that assistant, whatever it asked for.
func TestMCPPayeeAndMandateWaitForThePerson(t *testing.T) {
	a, lens, ck := mcpApp(t)
	client := jsonOf(t, serve(a, "POST", "/oauth/register", "", `{"client_name":"Claude","redirect_uris":["`+claudeReturn+`"]}`, nil, nil))
	token := connect(t, a, ck, client["client_id"].(string))["access_token"].(string)
	saw := func(route string) bool {
		_, ok := lens.sent[route]
		return ok
	}
	waiting := func() []any {
		rec := serve(a, "GET", "/api/money/assistant-requests", "", "", nil, ck)
		if rec.Code != http.StatusOK {
			t.Fatalf("assistant requests: %d %s", rec.Code, rec.Body.String())
		}
		return jsonOf(t, rec)["requests"].([]any)
	}

	pr := toolCall(t, a, token, "create_payee_request", map[string]any{"name": "Acme Ltd", "country": "gb", "sort_code": "201555", "account_number": "55555555"})
	if pr["isError"] != false || !strings.Contains(pr["content"].([]any)[0].(map[string]any)["text"].(string), "Nothing has been saved") || saw("POST /v1/money/payees") {
		t.Fatalf("create_payee_request: %v; Lens saw %v", pr, lens.calls)
	}
	list := waiting()
	if len(list) != 1 || list[0].(map[string]any)["kind"] != "payee" || list[0].(map[string]any)["assistant"] != "Claude" {
		t.Fatalf("the Pay screen shows %v", list)
	}
	// The person presses Save: the existing route saves it, and the request is dismissed.
	details, _ := json.Marshal(list[0].(map[string]any)["details"])
	if rec := serve(a, "POST", "/api/money/payees", oauthOrigin, string(details), nil, ck); rec.Code != http.StatusCreated || lens.sent["POST /v1/money/payees"]["country"] != "GB" {
		t.Fatalf("save: %d %s, sent up %v", rec.Code, rec.Body.String(), lens.sent["POST /v1/money/payees"])
	}
	if rec := serve(a, "POST", "/api/money/assistant-requests/"+list[0].(map[string]any)["id"].(string)+"/dismiss", oauthOrigin, "", nil, ck); rec.Code != http.StatusNoContent || len(waiting()) != 0 {
		t.Fatalf("dismiss: %d, still waiting %v", rec.Code, waiting())
	}

	dm := toolCall(t, a, token, "draft_mandate", map[string]any{"clients": []any{"chat", "voice"}, "principal": map[string]any{"type": "company", "name": "Evil"},
		"scope": map[string]any{"payees": []any{"py-1"}, "currencies": []any{"GBP"}}, "limits": map[string]any{"per_payment": map[string]any{"GBP": 50000}},
		"new_payee": map[string]any{"policy": "always_ask"}, "expires_at": "2027-01-31T00:00:00Z"})
	terms := lens.sent["POST /v1/money/permission-mandates/prepare"]
	if dm["isError"] != false || saw("POST /v1/money/permission-mandates") || fmt.Sprint(terms["clients"]) != "[mcp:"+client["client_id"].(string)+"]" ||
		terms["principal"].(map[string]any)["type"] != "person" {
		t.Fatalf("draft_mandate: %v; checked with Lens as %v", dm, terms)
	}
	kept := waiting()[0].(map[string]any)
	if kept["details"].(map[string]any)["id"] != "pm-1" {
		t.Fatalf("the screen is shown %v, not the canonical terms Lens bound", kept["details"])
	}
	id := kept["id"].(string)
	if rec := serve(a, "POST", "/api/money/assistant-requests/"+id+"/prepare", oauthOrigin, "", nil, ck); rec.Code != http.StatusOK || jsonOf(t, rec)["challenge"] != "ch-1" {
		t.Fatalf("prepare: %d %s", rec.Code, rec.Body.String())
	}
	if rec := serve(a, "POST", "/api/money/assistant-requests/"+id+"/sign", oauthOrigin, `{"canonical":"{}"}`, nil, ck); rec.Code != http.StatusBadRequest || saw("POST /v1/money/permission-mandates") {
		t.Fatalf("a mandate was kept without a passkey: %d", rec.Code)
	}
	signed := `{"canonical":"{\"id\":\"pm-1\"}","assertion":{"credential_id":"cred-1","client_data_json":"e30","authenticator_data":"AA","signature":"AA"}}`
	if rec := serve(a, "POST", "/api/money/assistant-requests/"+id+"/sign", oauthOrigin, signed, nil, ck); rec.Code != http.StatusCreated ||
		lens.sent["POST /v1/money/permission-mandates"]["assertion"] == nil || len(waiting()) != 0 {
		t.Fatalf("sign: %d %s, still waiting %v", rec.Code, rec.Body.String(), waiting())
	}

	// Revoked, the connection's requests are gone with it.
	toolCall(t, a, token, "create_payee_request", map[string]any{"name": "Acme Ltd", "country": "GB", "iban": "GB33BUKB20201555555555"})
	for _, g := range a.oauth.grants.matching(func(oauthGrant) bool { return true }) {
		a.oauth.grants.delete(g.ID)
	}
	if left := waiting(); len(left) != 0 {
		t.Fatalf("a revoked connection's requests still wait: %v", left)
	}
}
