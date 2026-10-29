package main

// Talyvor Connect, part 2 (B40.7): the MCP server at https://app.talyvor.com/mcp, which prepares and never pays.
//
// An assistant connected by part 1 (oauth.go) calls these tools as the person and workspace its token names, on that
// person's own Lens credential. Each tool is one Lens route (prepare_payment_to_contact first reads the saved payees to find
// the one the person named), and none of them moves money: the request tools prepare a
// payment request (Lens B40.3) that waits for the person to approve it in the app, where B40.5 pays it. Anthropic does
// not allow software that transfers money for its users, and OpenAI bans executing money transfers, so no tool here
// approves, pays or pays out — TestMCPNoToolMovesMoney holds every tool's route to that.
//
// Streamable HTTP with no stream and no session: every POST is one JSON-RPC message, answered as JSON. The versions and
// the 2026-07-28 stateless rules are Lens's own (talyvor-lens internal/mcp/server.go).
//
// create_payee_request and draft_mandate keep what the assistant sent for the person to save or sign on the Pay screen
// (B40.35, mcp_drafts.go): neither saves a payee nor signs a mandate.

import (
	"bytes"
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

var (
	mcpVersions          = []string{"2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"}
	mcpModernVersions    = mcpVersions[:1]
	mcpHandshakeVersions = mcpVersions[1:]
)

const (
	mcpLegacyVersion   = "2024-11-05"
	mcpMetaVersion     = "io.modelcontextprotocol/protocolVersion"
	mcpErrParse        = -32700
	mcpErrInvalidReq   = -32600
	mcpErrMethodNotFnd = -32601
	mcpErrInvalidParam = -32602
	mcpErrHeader       = -32020 // 2026-07-28 HeaderMismatch
	mcpErrVersion      = -32022 // 2026-07-28 UnsupportedProtocolVersion
	mcpMaxBody         = 1 << 20
)

// What a tool does, as its annotations tell the client.
const (
	mcpReads  = iota // readOnlyHint
	mcpWrites        // changes something of the person's own; sends nothing, moves no money
	mcpSends         // destructiveHint: sends something to someone, or puts a payment in front of the person to approve
)

type mcpArgs map[string]json.RawMessage

func (m mcpArgs) str(k string) string {
	var s string
	_ = json.Unmarshal(m[k], &s)
	return strings.TrimSpace(s)
}

// without is the arguments less the named keys.
func (m mcpArgs) without(keys ...string) mcpArgs {
	out := mcpArgs{}
	for k, v := range m {
		if !slices.Contains(keys, k) {
			out[k] = v
		}
	}
	return out
}

// lensCall is the one Lens request a tool call makes; body is nil or JSON. A tool that keeps a draft (mcpTool.keeps) keeps
// body, and makes no Lens request when method is "".
type lensCall struct {
	method, path   string
	body           []byte
	idempotencyKey string
}

type mcpTool struct {
	name, title, description, scope string
	kind                            int
	keeps                           string // "payee" or "mandate": kept for the person to confirm (mcp_drafts.go)
	props                           map[string]any
	required                        []string
	call                            func(t tenant, g oauthGrant, args mcpArgs, raw json.RawMessage) (lensCall, error)
	// resolve, when set, reads Lens first: it returns the arguments call goes up with, or an answer for the assistant and no call.
	resolve func(a *app, ctx context.Context, t tenant, args mcpArgs) (mcpArgs, map[string]any, error)
	// shape, when set, is what the assistant is shown of Lens's answer.
	shape func(raw []byte) ([]byte, error)
}

var errMCPArgs = errors.New("the arguments are not the tool's")

func mcpGet(path string) func(tenant, oauthGrant, mcpArgs, json.RawMessage) (lensCall, error) {
	return func(tenant, oauthGrant, mcpArgs, json.RawMessage) (lensCall, error) {
		return lensCall{method: http.MethodGet, path: path}, nil
	}
}

// mcpByID is the Lens route path+"/"+the id argument+suffix.
func mcpByID(method, path, arg, suffix string) func(tenant, oauthGrant, mcpArgs, json.RawMessage) (lensCall, error) {
	return func(_ tenant, _ oauthGrant, a mcpArgs, _ json.RawMessage) (lensCall, error) {
		id := a.str(arg)
		if id == "" || len(id) > 200 {
			return lensCall{}, fmt.Errorf("%w: %s is required", errMCPArgs, arg)
		}
		return lensCall{method: method, path: path + "/" + url.PathEscape(id) + suffix}, nil
	}
}

// mcpPrepare is a payment request (Lens B40.3) judged as this assistant, "mcp:<client id>", whatever the arguments say.
// The items go up as the assistant sent them, so Lens refuses any bank detail among them and any field it does not know.
func mcpPrepare(items func(mcpArgs) any) func(tenant, oauthGrant, mcpArgs, json.RawMessage) (lensCall, error) {
	return func(_ tenant, g oauthGrant, a mcpArgs, _ json.RawMessage) (lensCall, error) {
		key := a.str("idempotency_key")
		if key == "" || len(key) > 128 {
			return lensCall{}, fmt.Errorf("%w: idempotency_key is required, at most 128 characters", errMCPArgs)
		}
		// UPSTREAM-BINDS-ONLY lensPaymentRequestBody: agent_id
		body, err := json.Marshal(map[string]any{"client": "mcp:" + g.ClientID, "items": items(a)})
		return lensCall{method: http.MethodPost, path: "/v1/money/payment-requests", idempotencyKey: key, body: body}, err
	}
}

func mcpOneItem(a mcpArgs) any { return []mcpArgs{a.without("idempotency_key")} }

var (
	mcpStr      = map[string]any{"type": "string"}
	mcpIdemKey  = map[string]any{"type": "string", "maxLength": 128, "description": "The same key with the same arguments returns the same request."}
	mcpItemArgs = map[string]any{
		"payee_id":     map[string]any{"type": "string", "description": "A saved payee's id, from list_payees."},
		"currency":     map[string]any{"type": "string", "enum": []string{"GBP", "EUR", "USD", "USDC"}},
		"amount_minor": map[string]any{"type": "integer", "minimum": 1, "description": "In the currency's minor units: pence, cents."},
		"reference":    map[string]any{"type": "string", "maxLength": 140},
	}
	mcpAmounts = map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "integer", "minimum": 1},
		"description": "Currency to minor units, e.g. {\"GBP\": 50000}."}
)

func withIdemKey(props map[string]any) map[string]any {
	out := map[string]any{"idempotency_key": mcpIdemKey}
	for k, v := range props {
		out[k] = v
	}
	return out
}

// mcpTools is the whole catalogue: separate read and write tools, each one Lens route, no catch-all.
var mcpTools = []mcpTool{
	{name: "get_balances", title: "Balances", scope: "wallets:read", kind: mcpReads,
		description: "The workspace's accounts in pounds, euros, dollars and USDC, with their balances.",
		call:        mcpGet("/v1/money/accounts")},
	{name: "list_agents", title: "Agents and their wallets", scope: "wallets:read", kind: mcpReads,
		description: "The workspace's agents, each with its wallet balance, status and spending rules.",
		call: func(t tenant, _ oauthGrant, _ mcpArgs, _ json.RawMessage) (lensCall, error) {
			return lensCall{method: http.MethodGet, path: lensWorkspacePath(t, "/agents")}, nil
		}},
	{name: "list_payees", title: "Saved payees", scope: "wallets:read", kind: mcpReads,
		description: "The saved payees outside Talyvor, each with what its bank said of the name and whether the person still has to confirm it.",
		call:        mcpGet("/v1/money/payees")},
	{name: "list_mandates", title: "Permission mandates", scope: "wallets:read", kind: mcpReads,
		description: "The permission mandates the person has signed: which assistants and agents may prepare payments, to whom, and up to what limits.",
		call:        mcpGet("/v1/money/permission-mandates")},
	{name: "market_search", title: "Search the marketplace", scope: "wallets:read", kind: mcpReads,
		description: "Marketplace listings matching a search, with their prices.",
		props: map[string]any{"q": mcpStr, "kind": map[string]any{"type": "string", "enum": []string{"agent", "prompt", "skill", "evaluation", "pipeline"}},
			"page": map[string]any{"type": "integer", "minimum": 1}},
		call: func(_ tenant, _ oauthGrant, a mcpArgs, _ json.RawMessage) (lensCall, error) {
			q := url.Values{}
			for _, k := range []string{"q", "kind"} {
				if v := a.str(k); v != "" {
					q.Set(k, v)
				}
			}
			var page int
			if json.Unmarshal(a["page"], &page) == nil && page > 0 {
				q.Set("page", fmt.Sprint(page))
			}
			return lensCall{method: http.MethodGet, path: "/v1/marketplace/search?" + q.Encode()}, nil
		}},
	{name: "market_listing", title: "Marketplace listing", scope: "wallets:read", kind: mcpReads,
		description: "One marketplace listing: what it does, its seller, its price and its terms.",
		props:       map[string]any{"listing_id": mcpStr}, required: []string{"listing_id"},
		call: mcpByID(http.MethodGet, "/v1/marketplace/listings", "listing_id", "")},
	{name: "get_request_status", title: "Payment request status", scope: "wallets:read", kind: mcpReads,
		description: "A prepared payment request: its status, its items and their decisions, and its approval link.",
		props:       map[string]any{"request_id": mcpStr}, required: []string{"request_id"},
		call: mcpByID(http.MethodGet, "/v1/money/payment-requests", "request_id", "")},
	{name: "bills_due", title: "Bills due", scope: "wallets:read", kind: mcpReads,
		description: "The workspace's bills that are due, soonest first: supplier, invoice number, amount, due date and whether the supplier is a saved payee, with the total per currency.",
		call:        mcpGet("/v1/money/bills"), shape: mcpBillsDue},
	{name: "safe_to_spend", title: "Safe to spend", scope: "wallets:read", kind: mcpReads,
		description: "What the company and each agent can safely spend this month in each currency: the balance less the scheduled payments, the bills due and the payments waiting for approval.",
		call: func(t tenant, _ oauthGrant, _ mcpArgs, _ json.RawMessage) (lensCall, error) {
			return lensCall{method: http.MethodGet, path: lensWorkspacePath(t, "/agents/safe-to-spend")}, nil
		}},

	{name: "draft_invoice", title: "Draft an invoice", scope: "invoices:draft", kind: mcpWrites,
		description: "Drafts an invoice from one of the workspace's accounts. The draft is not sent.",
		props: map[string]any{
			"account_id":    map[string]any{"type": "string", "description": "The account it is paid into, from get_balances."},
			"customer_name": mcpStr, "customer_email": mcpStr, "customer_address": mcpStr, "customer_vat_number": mcpStr,
			"seller_vat_number": mcpStr, "memo": mcpStr,
			"due_date": map[string]any{"type": "string", "description": "YYYY-MM-DD"},
			"lines": map[string]any{"type": "array", "minItems": 1, "items": map[string]any{"type": "object",
				"properties": map[string]any{"description": mcpStr, "quantity": map[string]any{"type": "integer", "minimum": 1},
					"unit_amount_minor": map[string]any{"type": "integer", "minimum": 0, "description": "In the account currency's minor units."},
					"vat_rate_bps":      map[string]any{"type": "integer", "minimum": 0, "description": "VAT in basis points: 2000 is 20%."}},
				"required": []string{"description", "quantity", "unit_amount_minor"}}},
		},
		required: []string{"account_id", "customer_name", "lines", "due_date"},
		call: func(_ tenant, _ oauthGrant, _ mcpArgs, raw json.RawMessage) (lensCall, error) {
			var in struct {
				AccountID         string        `json:"account_id"`
				CustomerName      string        `json:"customer_name"`
				CustomerEmail     string        `json:"customer_email"`
				CustomerAddress   string        `json:"customer_address"`
				CustomerVATNumber string        `json:"customer_vat_number"`
				SellerVATNumber   string        `json:"seller_vat_number"`
				Lines             []invoiceLine `json:"lines"`
				DueDate           string        `json:"due_date"`
				RemindDaysBefore  int           `json:"remind_days_before"`
				Memo              string        `json:"memo"`
				Send              bool          `json:"send"` // always false: send_invoice sends it
			}
			if err := json.Unmarshal(raw, &in); len(raw) > 0 && err != nil {
				return lensCall{}, fmt.Errorf("%w: %v", errMCPArgs, err)
			}
			in.Send = false
			// UPSTREAM-BINDS-ONLY lensMCPInvoiceDraftBody: currency
			body, err := json.Marshal(in)
			return lensCall{method: http.MethodPost, path: "/v1/money/invoices", body: body}, err
		}},
	{name: "send_invoice", title: "Send an invoice", scope: "invoices:draft", kind: mcpSends,
		description: "Sends a drafted invoice to its customer and opens its pay link.",
		props:       map[string]any{"invoice_id": mcpStr}, required: []string{"invoice_id"},
		call: mcpByID(http.MethodPost, "/v1/money/invoices", "invoice_id", "/send")},

	{name: "create_payee_request", title: "Ask to add a payee", scope: "invoices:draft", kind: mcpWrites, keeps: "payee",
		description: "Asks the person to add a payee outside Talyvor. It is not saved, and cannot be paid, until the person saves it in Talyvor.",
		props: map[string]any{"name": map[string]any{"type": "string", "maxLength": 140, "description": "The name on the account."},
			"country":   map[string]any{"type": "string", "description": "Two letters: GB, IE, US."},
			"sort_code": mcpStr, "account_number": mcpStr, "iban": mcpStr, "bic": mcpStr, "routing_number": mcpStr},
		required: []string{"name", "country"},
		call:     mcpCreatePayeeRequest},
	{name: "draft_mandate", title: "Draft a permission mandate", scope: "payments:prepare", kind: mcpWrites, keeps: "mandate",
		description: "Drafts a permission mandate for this assistant: whom it may prepare payments to, in which currencies and up to what limits. " +
			"It has no effect until the person signs it in Talyvor.",
		props: map[string]any{
			"scope": map[string]any{"type": "object", "properties": map[string]any{
				"payees":           map[string]any{"type": "array", "items": mcpStr, "description": "Saved payees' ids, from list_payees."},
				"payee_categories": map[string]any{"type": "array", "items": mcpStr},
				"sellers":          map[string]any{"type": "array", "items": mcpStr, "description": "Marketplace sellers' ids."},
				"currencies":       map[string]any{"type": "array", "items": mcpItemArgs["currency"]}},
				"required": []string{"currencies"}},
			"limits": map[string]any{"type": "object", "description": "Each a map of currency to minor units; a currency left out has no limit of that kind.",
				"properties": map[string]any{"per_payment": mcpAmounts, "per_day": mcpAmounts, "per_month": mcpAmounts, "batch_total": mcpAmounts,
					"payments_per_hour": map[string]any{"type": "integer", "minimum": 0}}},
			"requires_approval_above": mcpAmounts,
			"new_payee": map[string]any{"type": "object", "properties": map[string]any{
				"policy":            map[string]any{"type": "string", "enum": []string{"always_ask", "confirmation_of_payee", "cooling_off"}},
				"cooling_off_hours": map[string]any{"type": "integer", "minimum": 0}}, "required": []string{"policy"}},
			"expires_at": map[string]any{"type": "string", "description": "RFC 3339, e.g. 2027-01-31T00:00:00Z"},
		},
		required: []string{"scope", "new_payee", "expires_at"},
		call:     mcpDraftMandate},

	{name: "prepare_payment", title: "Prepare a payment for approval", scope: "payments:prepare", kind: mcpSends,
		description: "Prepares one payment to a saved payee as a request the person approves in Talyvor. It pays nothing.",
		props:       withIdemKey(mcpItemArgs), required: []string{"idempotency_key", "payee_id", "currency", "amount_minor"},
		call: mcpPrepare(mcpOneItem)},
	{name: "prepare_payment_to_contact", title: "Prepare a payment to a contact for approval", scope: "payments:prepare", kind: mcpSends,
		description: "Prepares one payment to the person's saved, confirmed contact named contact (\"Mike\") as a request the person approves in Talyvor. " +
			"It pays nothing, and takes no payment details: when no contact or several match, it answers with a question for the person.",
		props: withIdemKey(map[string]any{"contact": map[string]any{"type": "string", "maxLength": 140, "description": "The contact's name as the person said it."},
			"currency": mcpItemArgs["currency"], "amount_minor": mcpItemArgs["amount_minor"], "reference": mcpItemArgs["reference"]}),
		required: []string{"idempotency_key", "contact", "currency", "amount_minor"},
		resolve:  (*app).mcpContact, call: mcpPrepare(mcpOneItem)},
	{name: "prepare_batch", title: "Prepare payments for approval", scope: "payments:prepare", kind: mcpSends,
		description: "Prepares several payments to saved payees as one request the person approves once in Talyvor. It pays nothing.",
		props: withIdemKey(map[string]any{"items": map[string]any{"type": "array", "minItems": 1, "items": map[string]any{
			"type": "object", "properties": mcpItemArgs, "required": []string{"payee_id", "currency", "amount_minor"}}}}),
		required: []string{"idempotency_key", "items"},
		call:     mcpPrepare(func(a mcpArgs) any { return a["items"] })},
	{name: "request_marketplace_purchase", title: "Prepare a marketplace purchase for approval", scope: "payments:prepare", kind: mcpSends,
		description: "Prepares the purchase of a marketplace listing at its price as a request the person approves in Talyvor. It pays nothing.",
		props:       withIdemKey(map[string]any{"listing_id": mcpStr, "reference": mcpItemArgs["reference"]}),
		required:    []string{"idempotency_key", "listing_id"},
		call:        mcpPrepare(mcpOneItem)},
	{name: "cancel_request", title: "Cancel a payment request", scope: "payments:prepare", kind: mcpSends,
		description: "Cancels a prepared payment request that has not been approved.",
		props:       map[string]any{"request_id": mcpStr}, required: []string{"request_id"},
		call: mcpByID(http.MethodPost, "/v1/money/payment-requests", "request_id", "/cancel")},
}

func (t mcpTool) definition() map[string]any {
	props := t.props
	if props == nil {
		props = map[string]any{}
	}
	schema := map[string]any{"type": "object", "properties": props}
	if len(t.required) > 0 {
		schema["required"] = t.required
	}
	return map[string]any{"name": t.name, "title": t.title, "description": t.description, "inputSchema": schema,
		"annotations": map[string]any{"title": t.title, "readOnlyHint": t.kind == mcpReads, "destructiveHint": t.kind == mcpSends,
			"idempotentHint": t.kind == mcpReads, "openWorldHint": false}}
}

type mcpMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type mcpResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *mcpError       `json:"error,omitempty"`
}

func mcpOK(id json.RawMessage, r any) mcpResponse {
	return mcpResponse{JSONRPC: "2.0", ID: id, Result: r}
}

func mcpErr(id json.RawMessage, code int, msg string) mcpResponse {
	return mcpResponse{JSONRPC: "2.0", ID: id, Error: &mcpError{Code: code, Message: msg}}
}

func (r mcpMessage) param(key string) string {
	var p map[string]json.RawMessage
	_ = json.Unmarshal(r.Params, &p)
	var v string
	_ = json.Unmarshal(p[key], &v)
	return v
}

// metaVersion is the version a 2026-07-28 request names in params._meta; "" for a request of the handshake era.
func (r mcpMessage) metaVersion() string {
	var p struct {
		Meta map[string]any `json:"_meta"`
	}
	_ = json.Unmarshal(r.Params, &p)
	v, _ := p.Meta[mcpMetaVersion].(string)
	return v
}

// headerValue undoes the =?base64?…?= form a 2026-07-28 client sends a value that is not plain ASCII in.
func headerValue(h string) string {
	if v, ok := strings.CutPrefix(h, "=?base64?"); ok && strings.HasSuffix(v, "?=") {
		if b, err := base64.StdEncoding.DecodeString(strings.TrimSuffix(v, "?=")); err == nil {
			return string(b)
		}
	}
	return h
}

// handleMCP answers one JSON-RPC message from an assistant connected by oauth.go.
func (a *app) handleMCP(w http.ResponseWriter, r *http.Request) {
	// Streamable HTTP lets a server with no SSE stream and no sessions answer GET and DELETE 405.
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	g, ok := a.oauthGrantFrom(w, r)
	if !ok {
		return
	}
	status := http.StatusOK
	var req mcpMessage
	var resp mcpResponse
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, mcpMaxBody)).Decode(&req)
	header, modern := r.Header.Get("MCP-Protocol-Version"), req.metaVersion()
	switch {
	case err != nil:
		resp = mcpErr(nil, mcpErrParse, "Parse error")
	case req.JSONRPC != "2.0" || req.Method == "":
		resp = mcpErr(req.ID, mcpErrInvalidReq, "Invalid request: one JSON-RPC 2.0 message")
	case header != "" && !slices.Contains(mcpVersions, header) || modern != "" && !slices.Contains(mcpModernVersions, modern):
		status, resp = http.StatusBadRequest, mcpErr(req.ID, mcpErrVersion, "Unsupported protocol version")
		resp.Error.Data = map[string]any{"supported": mcpVersions, "requested": cmp.Or(modern, header)}
	case modern != "" && (header != modern || r.Header.Get("Mcp-Method") != req.Method ||
		req.Method == "tools/call" && headerValue(r.Header.Get("Mcp-Name")) != req.param("name")):
		status, resp = http.StatusBadRequest, mcpErr(req.ID, mcpErrHeader, "Header mismatch: MCP-Protocol-Version, Mcp-Method and Mcp-Name must match the body")
	case len(req.ID) == 0 || string(req.ID) == "null":
		// A notification (notifications/initialized, …): nothing to send back.
		w.WriteHeader(http.StatusAccepted)
		return
	default:
		resp = a.mcpDispatch(r.Context(), g, cmp.Or(modern, header), req)
		if modern != "" {
			status = mcpStateless(&resp, req.Method)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, resp)
}

func mcpServerInfo() map[string]any {
	return map[string]any{"name": "talyvor", "title": "Talyvor", "version": bffVersion}
}

// mcpStateless finishes a 2026-07-28 answer: every result says it is complete and who answered, a list says how long it
// may be cached, and an unknown method is a 404.
func mcpStateless(resp *mcpResponse, method string) int {
	if resp.Error != nil {
		if resp.Error.Code == mcpErrMethodNotFnd {
			return http.StatusNotFound
		}
		return http.StatusOK
	}
	if m, ok := resp.Result.(map[string]any); ok {
		m["resultType"] = "complete"
		m["_meta"] = map[string]any{"io.modelcontextprotocol/serverInfo": mcpServerInfo()}
		if method == "tools/list" || method == "server/discover" {
			m["ttlMs"], m["cacheScope"] = 300_000, "private"
		}
	}
	return http.StatusOK
}

func (a *app) mcpDispatch(ctx context.Context, g oauthGrant, version string, req mcpMessage) mcpResponse {
	switch req.Method {
	case "initialize":
		v := mcpLegacyVersion
		if asked := req.param("protocolVersion"); asked != "" {
			v = mcpHandshakeVersions[0]
			if slices.Contains(mcpHandshakeVersions, asked) {
				v = asked
			}
		}
		return mcpOK(req.ID, map[string]any{"protocolVersion": v, "capabilities": map[string]any{"tools": map[string]any{}},
			"serverInfo": mcpServerInfo()})
	case "server/discover":
		return mcpOK(req.ID, map[string]any{"supportedVersions": mcpVersions, "capabilities": map[string]any{"tools": map[string]any{}}})
	case "ping":
		return mcpOK(req.ID, map[string]any{})
	case "tools/list":
		tools := []map[string]any{}
		for _, t := range mcpTools {
			if grantHas(g, t.scope) {
				tools = append(tools, t.definition())
			}
		}
		return mcpOK(req.ID, map[string]any{"tools": tools})
	case "tools/call":
		return a.mcpCallTool(ctx, g, version, req)
	}
	return mcpErr(req.ID, mcpErrMethodNotFnd, "method not found: "+req.Method)
}

func grantHas(g oauthGrant, scope string) bool {
	return slices.Contains(strings.Fields(g.Scope), scope)
}

// mcpRefusal is a tool's answer when it did not do what was asked: the model reads the sentence.
func mcpRefusal(id json.RawMessage, sentence string) mcpResponse {
	return mcpOK(id, map[string]any{"content": []map[string]any{{"type": "text", "text": sentence}}, "isError": true})
}

func (a *app) mcpCallTool(ctx context.Context, g oauthGrant, version string, req mcpMessage) mcpResponse {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return mcpErr(req.ID, mcpErrInvalidParam, "Invalid params: "+err.Error())
	}
	i := slices.IndexFunc(mcpTools, func(t mcpTool) bool { return t.name == p.Name })
	if i < 0 {
		return mcpErr(req.ID, mcpErrInvalidParam, "unknown tool: "+p.Name)
	}
	tool := mcpTools[i]
	if !grantHas(g, tool.scope) {
		return mcpRefusal(req.ID, fmt.Sprintf("%s needs the permission %q, which this connection was not given.", tool.name, tool.scope))
	}
	t, ok := a.mcpTenant(ctx, g)
	if !ok {
		return mcpRefusal(req.ID, "Talyvor could not reach this workspace just now. Try again shortly.")
	}
	var args mcpArgs
	_ = json.Unmarshal(p.Arguments, &args)
	if tool.resolve != nil {
		next, answer, err := tool.resolve(a, ctx, t, args)
		switch {
		case errors.Is(err, errMCPArgs):
			return mcpRefusal(req.ID, err.Error())
		case err != nil:
			log.Printf("bff: mcp %s for client %q: %v", tool.name, g.ClientName, err)
			return mcpRefusal(req.ID, "Talyvor could not answer just now. Try again shortly.")
		case answer != nil:
			return mcpOK(req.ID, map[string]any{"content": []map[string]any{{"type": "text", "text": answer["question"]}}, "structuredContent": answer, "isError": false})
		}
		args = next
	}
	c, err := tool.call(t, g, args, p.Arguments)
	if err != nil {
		return mcpRefusal(req.ID, err.Error())
	}
	status, raw := http.StatusOK, []byte(nil)
	if c.method != "" {
		status, raw, err = a.mcpLens(ctx, t, c)
	}
	switch {
	case err != nil || status >= 500:
		log.Printf("bff: mcp %s for client %q: lens %d %v", tool.name, g.ClientName, status, err)
		return mcpRefusal(req.ID, "Talyvor could not answer just now. Try again shortly.")
	case status >= 400:
		var refusal struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Talyvor refused this."
		}
		return mcpRefusal(req.ID, refusal.Error)
	}
	if tool.keeps != "" {
		if raw, err = a.keepDraft(t, g, tool.keeps, c.body, raw); err != nil {
			return mcpRefusal(req.ID, err.Error())
		}
	}
	if tool.shape != nil {
		if raw, err = tool.shape(raw); err != nil {
			log.Printf("bff: mcp %s for client %q: %v", tool.name, g.ClientName, err)
			return mcpRefusal(req.ID, "Talyvor could not answer just now. Try again shortly.")
		}
	}
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil {
		out = map[string]any{"result": json.RawMessage(raw)}
	}
	content := []map[string]any{{"type": "text", "text": string(raw)}}
	if link, _ := out["approval_url"].(string); link != "" && tool.kind == mcpSends {
		deep, _ := out["deep_link"].(string)
		content = append([]map[string]any{{"type": "text", "text": "Nothing has been paid. The request waits for the person to approve it in Talyvor at " +
			link + " (on their phone: " + deep + ")."}}, content...)
		// A link the client can show as one; resource_link arrived with 2025-06-18, so older clients are not sent it.
		if version >= "2025-06-18" {
			content = append(content, map[string]any{"type": "resource_link", "uri": link, "name": "Approve in Talyvor", "mimeType": "text/html"})
		}
	}
	if link, _ := out["confirm_url"].(string); link != "" && tool.keeps != "" {
		content = append([]map[string]any{{"type": "text", "text": "Nothing has been saved or signed. It waits for the person to confirm it in Talyvor at " +
			link + "."}}, content...)
		if version >= "2025-06-18" {
			content = append(content, map[string]any{"type": "resource_link", "uri": link, "name": "Confirm in Talyvor", "mimeType": "text/html"})
		}
	}
	return mcpOK(req.ID, map[string]any{"content": content, "structuredContent": out, "isError": false})
}

// mcpBillsDue is Lens's bills (B41.101) as its own list_bills_due shows them (talyvor-lens internal/mcp, B45.17): the due
// ones, in Lens's order, and never the bank details printed on them — a bill is paid to its saved payee.
func mcpBillsDue(raw []byte) ([]byte, error) {
	type dueBill struct {
		ID            string   `json:"id"`
		Supplier      string   `json:"supplier"`
		InvoiceNumber string   `json:"invoice_number,omitempty"`
		AmountMinor   int64    `json:"amount_minor"`
		Currency      string   `json:"currency"`
		DueDate       string   `json:"due_date,omitempty"`
		PayeeID       string   `json:"payee_id,omitempty"`
		PayeeMatch    string   `json:"payee_match"`
		Missing       []string `json:"missing"`
		Status        string   `json:"status"`
	}
	var in struct {
		Bills []dueBill `json:"bills"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	out, totals := []dueBill{}, map[string]int64{}
	for _, b := range in.Bills {
		if b.Status != "due" {
			continue
		}
		out = append(out, b)
		if b.Currency != "" {
			totals[b.Currency] += b.AmountMinor
		}
	}
	return json.Marshal(map[string]any{"bills": out, "count": len(out), "totals": totals})
}

// mcpContact is B45.14's "Transfer $500 to Mike" on this server, by Lens's own prepare_transfer_to_contact rule
// (talyvor-lens economy.PayeesNamed): contact names a saved payee when its name holds it as whole words, in any case
// ("mike" finds "Mike Jones", never "Mikel"). Exactly one confirmed payee goes up as the one item's payee_id; none, an
// unconfirmed one or several answer a question and prepare nothing. Details from the chat never become a payee.
func (a *app) mcpContact(ctx context.Context, t tenant, args mcpArgs) (mcpArgs, map[string]any, error) {
	said := strings.Join(strings.Fields(args.str("contact")), " ")
	if said == "" || len(said) > 140 {
		return nil, nil, fmt.Errorf("%w: contact is required, at most 140 characters", errMCPArgs)
	}
	status, raw, err := a.mcpLens(ctx, t, lensCall{method: http.MethodGet, path: "/v1/money/payees"})
	var list struct {
		Payees []struct {
			ID                json.RawMessage `json:"id"` // forwarded as Lens wrote it
			Name              string          `json:"name"`
			NeedsConfirmation bool            `json:"needs_confirmation"`
		} `json:"payees"`
	}
	if err == nil && status != http.StatusOK {
		err = fmt.Errorf("lens answered GET /v1/money/payees %d", status)
	}
	if err == nil {
		err = json.Unmarshal(raw, &list)
	}
	if err != nil {
		return nil, nil, err
	}
	confirmed, unconfirmed, named, ids := []map[string]any{}, []string{}, []string{}, []json.RawMessage{}
	q := " " + strings.ToLower(said) + " "
	for _, p := range list.Payees {
		var id string
		switch {
		case !strings.Contains(" "+strings.ToLower(strings.Join(strings.Fields(p.Name), " "))+" ", q):
		case p.NeedsConfirmation:
			unconfirmed = append(unconfirmed, p.Name)
		case json.Unmarshal(p.ID, &id) == nil && id != "":
			confirmed = append(confirmed, map[string]any{"payee_id": id, "name": p.Name})
			named, ids = append(named, fmt.Sprintf("%s (payee_id %s)", p.Name, id)), append(ids, p.ID)
		}
	}
	ask := func(question string) (mcpArgs, map[string]any, error) {
		return nil, map[string]any{"question": question, "contacts": confirmed}, nil
	}
	switch {
	case len(confirmed) > 1:
		return ask(fmt.Sprintf("Which %s? The saved contacts called %s are %s: ask the person which they mean, then prepare_payment to that contact's payee_id.",
			said, said, strings.Join(named, " and ")))
	case len(confirmed) == 0 && len(unconfirmed) > 0:
		return ask(strings.Join(unconfirmed, ", ") + " is saved but not confirmed yet: ask the person to confirm them in the app first.")
	case len(confirmed) == 0:
		return ask(fmt.Sprintf("No saved contact is called %q: ask the person to add them in the app. Payment details from the chat are never used.", said))
	}
	next := args.without("contact", "payee_id")
	next["payee_id"] = ids[0]
	return next, nil, nil
}

// mcpTenant is the grant's workspace and Lens credential, re-minted by provisioning near its expiry as a session's is
// (refreshWorkspaceToken) — and refused if provisioning names any other workspace than the one the person consented as.
func (a *app) mcpTenant(ctx context.Context, g oauthGrant) (tenant, bool) {
	who := g.Who
	if !who.synthetic && !who.lensTokenExp.IsZero() && !time.Now().Before(who.lensTokenExp.Add(-workspaceTokenSkew)) {
		prov, err := a.provisionForSession(ctx, provisionIdentity(a.cfg.oidcIssuer, who.sub))
		if err != nil || prov.WorkspaceID != who.workspaceID {
			log.Printf("bff: mcp workspace token re-mint for sub=%s failed (workspace %q): %v", who.sub, prov.WorkspaceID, err)
			return tenant{}, false
		}
		who.lensToken, who.lensTokenExp = prov.Token, parseExpiry(prov.ExpiresAt)
		a.oauth.grants.update(g.ID, func(cur oauthGrant) oauthGrant { cur.Who = who; return cur })
	}
	t := tenant{workspaceID: who.workspaceID, token: who.lensToken}
	return t, t.ok()
}

// mcpLens makes a tool's one Lens request on the person's own credential.
func (a *app) mcpLens(ctx context.Context, t tenant, c lensCall) (int, []byte, error) {
	var rd io.Reader
	if c.body != nil {
		rd = bytes.NewReader(c.body)
	}
	req, err := http.NewRequestWithContext(ctx, c.method, a.cfg.lensBaseURL+c.path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // server-side only
	req.Header.Set("Accept", "application/json")
	if c.body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", c.idempotencyKey)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, raw, err
}
