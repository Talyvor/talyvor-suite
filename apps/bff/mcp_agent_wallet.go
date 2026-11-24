package main

// B48.41 — an agent's own wallets on app.talyvor.com/mcp. An agent that calls this server with its own Lens key (not an
// assistant's Connect token, oauth.go) is offered B48.16's wallet tools, and every one of them is Lens's: each call is
// passed to Lens's /mcp on the agent's key, so Lens alone decides what the key reads and whether a send goes, waits for
// the owner or is refused. This server never answers a money call itself.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
)

// agentWalletTools are B48.16's tools on Lens's /mcp that an agent's key reaches here (talyvor-lens
// internal/mcp/agent_wallet_tools.go). wallet_send and wallet_request are the USDC wallet's only with a network: without
// one Lens reads them as the credit tools, which are not offered here.
var agentWalletTools = []string{"wallet_list", "wallet_balance", "wallet_receive_details", "wallet_history", "wallet_send", "wallet_request"}

// lensAgentKeyShape is a Lens API key as talyvor-lens internal/auth mints one ("tlv_" and 64 hex characters): an agent's
// own key is one of these. None of this server's tokens (tlv_oat_…) has the shape.
var lensAgentKeyShape = regexp.MustCompile(`^tlv_[0-9a-f]{64}$`)

// lensAgentKey is the request's bearer when it is shaped as an agent's own Lens key.
func lensAgentKey(r *http.Request) (string, bool) {
	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	raw = strings.TrimSpace(raw)
	return raw, ok && lensAgentKeyShape.MatchString(raw)
}

// errLensRefusedAgentKey is Lens answering the agent's key 401 or 403: handleMCP refuses it as an unknown token.
var errLensRefusedAgentKey = fmt.Errorf("lens refused the agent's key")

// agentWalletDispatch answers one message from an agent's key. Every message reaches Lens on the key, so one Lens does not
// know is refused even by initialize.
func (a *app) agentWalletDispatch(ctx context.Context, key, version string, req mcpMessage) (mcpResponse, error) {
	switch req.Method {
	case "initialize", "server/discover", "ping":
		if _, err := a.lensAgentMCP(ctx, key, "ping", map[string]any{}); err != nil {
			return mcpResponse{}, err
		}
		return a.mcpDispatch(ctx, oauthGrant{}, version, req), nil
	case "tools/list":
		reply, err := a.lensAgentMCP(ctx, key, "tools/list", map[string]any{})
		if err != nil || reply.Error != nil {
			return lensAgentAnswer(req.ID, reply), err
		}
		var listed struct {
			Tools []map[string]any `json:"tools"`
		}
		if err := json.Unmarshal(reply.Result, &listed); err != nil {
			return mcpResponse{}, err
		}
		tools := []map[string]any{}
		for _, t := range listed.Tools {
			if name, _ := t["name"].(string); slices.Contains(agentWalletTools, name) {
				tools = append(tools, t)
			}
		}
		return mcpOK(req.ID, map[string]any{"tools": tools}), nil
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return mcpErr(req.ID, mcpErrInvalidParam, "Invalid params: "+err.Error()), nil
		}
		if !slices.Contains(agentWalletTools, p.Name) {
			return mcpErr(req.ID, mcpErrInvalidParam, "unknown tool: "+p.Name), nil
		}
		var args mcpArgs
		_ = json.Unmarshal(p.Arguments, &args)
		if (p.Name == "wallet_send" || p.Name == "wallet_request") && args.str("network") == "" {
			return mcpRefusal(req.ID, p.Name+" here is your USDC wallet's: name the network, from wallet_receive_details."), nil
		}
		if len(p.Arguments) == 0 || string(p.Arguments) == "null" {
			p.Arguments = json.RawMessage(`{}`)
		}
		reply, err := a.lensAgentMCP(ctx, key, "tools/call", map[string]any{"name": p.Name, "arguments": p.Arguments})
		return lensAgentAnswer(req.ID, reply), err
	}
	return mcpErr(req.ID, mcpErrMethodNotFnd, "method not found: "+req.Method), nil
}

// lensAgentMCP sends one JSON-RPC request to Lens's /mcp on the agent's key; errLensRefusedAgentKey when Lens does not know it.
func (a *app) lensAgentMCP(ctx context.Context, key, method string, params any) (mcpReply, error) {
	reply, status, err := a.mcpCall(mcpReq(ctx), tenant{token: key}, method, params)
	switch {
	case err != nil:
		return reply, err
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return reply, errLensRefusedAgentKey
	case status != http.StatusOK:
		return reply, fmt.Errorf("lens answered %s %d", method, status)
	}
	return reply, nil
}

// lensAgentAnswer is Lens's answer to the agent, as Lens gave it.
func lensAgentAnswer(id json.RawMessage, reply mcpReply) mcpResponse {
	if reply.Error != nil {
		return mcpErr(id, reply.Error.Code, reply.Error.Message)
	}
	var result map[string]any
	if json.Unmarshal(reply.Result, &result) != nil {
		return mcpErr(id, -32603, "Talyvor could not read Lens's answer")
	}
	return mcpOK(id, result)
}
