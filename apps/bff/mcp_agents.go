package main

// B52.6 — Talyvor Connect pays, creates and manages agents from the chat.
//
//	send_payment            pays another agent from one of the person's, on a Connect token (Lens B52.4) minted for that
//	                        agent and this assistant alone: inside the agent's limits Lens pays, above them it files an
//	                        approval the person signs with their passkey. Prepare-only (BFF_CONNECT_PREPARE_ONLY) pays nothing.
//	create_agent            an agent with starting limits no higher than the ceiling the person set on Settings → Connect your AI
//	pause_agent             stops an agent spending; resuming it is the person's, in Talyvor
//	set_agent_limits        a lower limit applies at once; a higher one is not applied, and the person raises it in Talyvor
//	get_statement           an agent's statement
//	list_incoming_requests  the money requests waiting on the person's agents
//	open_topup              the link to top up in Talyvor: nothing is charged in the chat
//
//	GET /api/connect/agent-ceiling   the ceiling, or {} when the person has not set one
//	PUT /api/connect/agent-ceiling   {max_per_request_ulxc, daily_limit_ulxc, monthly_limit_ulxc}, each above 0
//
// Every call but send_payment's is on the person's own Lens credential, as every other tool's is (mcp.go).

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// agentLimits are the three limits an assistant may give or lower, named as Lens's agent rules name them. Zero is no limit.
var agentLimits = []string{"max_per_request_ulxc", "daily_limit_ulxc", "monthly_limit_ulxc"}

// connectCeiling is the most an assistant may give a new agent, per payment, per day and per month.
type connectCeiling struct {
	MaxPerRequestULXC int64 `json:"max_per_request_ulxc"`
	DailyLimitULXC    int64 `json:"daily_limit_ulxc"`
	MonthlyLimitULXC  int64 `json:"monthly_limit_ulxc"`
}

func (c connectCeiling) of(limit string) int64 {
	return map[string]int64{"max_per_request_ulxc": c.MaxPerRequestULXC, "daily_limit_ulxc": c.DailyLimitULXC, "monthly_limit_ulxc": c.MonthlyLimitULXC}[limit]
}

var (
	mcpAgentID    = map[string]any{"type": "string", "description": "One of the person's agents, from list_agents."}
	mcpULXC       = map[string]any{"type": "integer", "minimum": 1, "description": "In µLXC: 1,000,000 is one LXC."}
	mcpLimitProps = map[string]any{
		"max_per_request_ulxc": map[string]any{"type": "integer", "minimum": 0, "description": "The most one payment may be, in µLXC."},
		"daily_limit_ulxc":     map[string]any{"type": "integer", "minimum": 0, "description": "The most it may spend in a day, in µLXC."},
		"monthly_limit_ulxc":   map[string]any{"type": "integer", "minimum": 0, "description": "The most it may spend in a month, in µLXC."},
	}
)

func withAgentID(props map[string]any) map[string]any {
	out := map[string]any{"agent_id": mcpAgentID}
	for k, v := range props {
		out[k] = v
	}
	return out
}

// mcpAgentTools join mcpTools (mcp.go).
var mcpAgentTools = []mcpTool{
	{name: "send_payment", title: "Pay from an agent's wallet", scope: "payments:send", kind: mcpSends,
		description: "Pays another agent on Talyvor from one of the person's agents. Inside the limits the person set for that agent it pays at once; " +
			"above them it pays nothing and waits for the person to approve it with their passkey in Talyvor.",
		props: withIdemKey(withAgentID(map[string]any{"to_agent_id": map[string]any{"type": "string", "description": "The agent paid: its id or wallet id."},
			"amount_ulxc": mcpULXC, "memo": map[string]any{"type": "string", "maxLength": 140}})),
		required: []string{"idempotency_key", "agent_id", "to_agent_id", "amount_ulxc"},
		run:      (*app).mcpSendPayment},
	{name: "create_agent", title: "Create an agent", scope: "agents:write", kind: mcpWrites,
		description: "Creates an agent with its own wallet and starting limits, each no higher than the most the person lets an assistant give a new agent. " +
			"It starts with no money: the person funds it in Talyvor.",
		props: map[string]any{"name": map[string]any{"type": "string", "maxLength": 100}, "purpose": map[string]any{"type": "string", "maxLength": 500},
			"max_per_request_ulxc": mcpLimitProps["max_per_request_ulxc"], "daily_limit_ulxc": mcpLimitProps["daily_limit_ulxc"],
			"monthly_limit_ulxc": mcpLimitProps["monthly_limit_ulxc"]},
		required: []string{"name", "purpose", "max_per_request_ulxc", "daily_limit_ulxc", "monthly_limit_ulxc"},
		run:      (*app).mcpCreateAgent},
	{name: "pause_agent", title: "Pause an agent", scope: "agents:write", kind: mcpWrites,
		description: "Stops one of the person's agents spending. Only the person can resume it, in Talyvor.",
		props:       withAgentID(map[string]any{"reason": map[string]any{"type": "string", "maxLength": 200}}), required: []string{"agent_id"},
		call: func(t tenant, g oauthGrant, a mcpArgs, _ json.RawMessage) (lensCall, error) {
			id, err := agentIDArg(a)
			if err != nil {
				return lensCall{}, err
			}
			return lensCall{method: http.MethodPost, path: lensWorkspacePath(t, "/agents/"+url.PathEscape(id)+"/pause"),
				body: pauseBody(strings.TrimSuffix("Paused by "+g.ClientName+": "+a.str("reason"), ": "))}, nil
		}},
	{name: "set_agent_limits", title: "Lower an agent's limits", scope: "agents:write", kind: mcpWrites,
		description: "Lowers one of the person's agents' limits at once. A higher limit, or none, is not applied: the person raises it in Talyvor.",
		props:       withAgentID(mcpLimitProps), required: []string{"agent_id"},
		run: (*app).mcpSetAgentLimits},
	{name: "get_statement", title: "Agent statement", scope: "wallets:read", kind: mcpReads,
		description: "One of the person's agents' statement: what it was paid and what it paid, with its balance.",
		props:       map[string]any{"agent_id": mcpAgentID}, required: []string{"agent_id"},
		call: func(t tenant, _ oauthGrant, a mcpArgs, _ json.RawMessage) (lensCall, error) {
			id, err := agentIDArg(a)
			return lensCall{method: http.MethodGet, path: lensWorkspacePath(t, "/agents/"+url.PathEscape(id)+"/statement")}, err
		}},
	{name: "list_incoming_requests", title: "Money requests waiting", scope: "wallets:read", kind: mcpReads, openWorld: true,
		description: "The money requests other agents made of the person's agents that wait for an answer: who asks, of which agent, how much and why.",
		run:         (*app).mcpIncomingRequests},
	{name: "open_topup", title: "Top up in Talyvor", scope: "wallets:read", kind: mcpReads,
		description: "The link where the person tops up their Talyvor wallet. Nothing is charged in the chat.",
		run: func(a *app, _ context.Context, _ tenant, _ oauthGrant, _ mcpArgs) (map[string]any, error) {
			link := a.cfg.publicBaseURL + "/billing"
			return map[string]any{"url": link, "message": "The person tops up in Talyvor at " + link + ". Nothing is charged in the chat."}, nil
		}},
}

func init() { mcpTools = append(mcpTools, mcpAgentTools...) }

// pauseBody is Lens's pause body: the reason the person reads on the agent.
func pauseBody(reason string) []byte {
	// UPSTREAM-BINDS-ONLY lensAgentPauseBody: none
	body, _ := json.Marshal(map[string]string{"reason": reason})
	return body
}

func agentIDArg(a mcpArgs) (string, error) {
	id := a.str("agent_id")
	if id == "" || len(id) > 200 {
		return "", fmt.Errorf("%w: agent_id is required", errMCPArgs)
	}
	return id, nil
}

// ulxcArg is a whole µLXC amount argument; named is false when it was left out.
func ulxcArg(a mcpArgs, k string) (n int64, named bool, err error) {
	raw, named := a[k]
	if !named {
		return 0, false, nil
	}
	if json.Unmarshal(raw, &n) != nil || n < 0 {
		return 0, true, fmt.Errorf("%w: %s is a whole number of µLXC, 0 or more", errMCPArgs, k)
	}
	return n, true, nil
}

// lensRefusal is the sentence a Lens 4xx carries, for the assistant.
func lensRefusal(raw []byte) mcpSaid {
	var r struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &r) != nil || r.Error == "" {
		return "Talyvor refused this."
	}
	return mcpSaid(r.Error)
}

// lensOK makes one Lens call and returns its answer; a 4xx is Lens's sentence as mcpSaid.
func (a *app) lensOK(ctx context.Context, t tenant, c lensCall) ([]byte, error) {
	status, raw, err := a.mcpLens(ctx, t, c)
	switch {
	case err != nil:
		return nil, err
	case status >= 500:
		return nil, fmt.Errorf("lens answered %s %s %d", c.method, c.path, status)
	case status >= 400:
		return nil, lensRefusal(raw)
	}
	return raw, nil
}

func (a *app) mcpSendPayment(ctx context.Context, t tenant, g oauthGrant, args mcpArgs) (map[string]any, error) {
	key, err := mcpIdempotencyKey(args)
	if err != nil {
		return nil, err
	}
	agentID, err := agentIDArg(args)
	if err != nil {
		return nil, err
	}
	to, memo := args.str("to_agent_id"), args.str("memo")
	amount, _, err := ulxcArg(args, "amount_ulxc")
	if err == nil && (to == "" || len(to) > 200 || amount < 1 || len(memo) > 140) {
		err = fmt.Errorf("%w: to_agent_id and an amount_ulxc above 0 are required, the memo at most 140 characters", errMCPArgs)
	}
	if err != nil {
		return nil, err
	}
	if a.cfg.connectPrepareOnly {
		return nil, mcpSaid("Nothing has been paid: this connection does not pay. The person pays from the agent in Talyvor at " + a.cfg.publicBaseURL + "/agents.")
	}
	if a.cfg.lensConnectMintKey == "" {
		log.Printf("bff: mcp send_payment for client %q: LENS_CONNECT_MINT_KEY is unset", g.ClientName)
		return nil, mcpSaid("Nothing has been paid: Talyvor cannot pay through an assistant just now. The person can pay from the agent in Talyvor.")
	}
	// The token pays from this one agent, for this assistant, and Lens refuses it everywhere else (B52.4).
	// user_id is the person's own Lens user id, which is their workspace's: Lens's provision mints their token with both
	// the same, the agents they make are owned by it, and Lens mints only for an agent that user owns (B54.13).
	// UPSTREAM-BINDS-ONLY lensConnectTokenBody: none
	mintBody, _ := json.Marshal(map[string]any{"workspace_id": t.workspaceID, "user_id": t.workspaceID, "client_id": g.ClientID, "agent_id": agentID, "scopes": []string{"payments:send"}})
	raw, err := a.lensOK(ctx, tenant{workspaceID: t.workspaceID, token: a.cfg.lensConnectMintKey},
		lensCall{method: http.MethodPost, path: "/v1/auth/connect-token", body: mintBody})
	var minted map[string]any
	if err == nil {
		err = json.Unmarshal(raw, &minted)
	}
	if err != nil {
		return nil, err
	}
	// The approval screen and both statements show the memo, so it names the assistant that asked.
	memo = strings.TrimSpace(memo + " (asked by " + g.ClientName + ")")
	// UPSTREAM-BINDS-ONLY lensAgentPayBody: none
	body, _ := json.Marshal(map[string]any{"to_agent_id": to, "amount_ulxc": amount, "memo": memo})
	connectToken, _ := minted["token"].(string)
	status, raw, err := a.mcpLens(ctx, tenant{workspaceID: t.workspaceID, token: connectToken},
		lensCall{method: http.MethodPost, path: lensWorkspacePath(t, "/agents/"+url.PathEscape(agentID)+"/pay"), body: body, idempotencyKey: key})
	switch {
	case err != nil:
		return nil, err
	case status >= 500:
		return nil, fmt.Errorf("lens answered pay %d", status)
	case status == http.StatusAccepted:
		var pending map[string]any
		if err := json.Unmarshal(raw, &pending); err != nil {
			return nil, err
		}
		pending["approval_url"] = a.cfg.publicBaseURL + "/approvals"
		return pending, nil
	case status >= 400:
		return nil, lensRefusal(raw)
	}
	var paid map[string]any
	if err := json.Unmarshal(raw, &paid); err != nil {
		return nil, err
	}
	return map[string]any{"status": "paid", "payment": paid}, nil
}

func (a *app) mcpCreateAgent(ctx context.Context, t tenant, g oauthGrant, args mcpArgs) (map[string]any, error) {
	name, purpose := args.str("name"), args.str("purpose")
	if name == "" || len(name) > 100 || purpose == "" || len(purpose) > 500 {
		return nil, fmt.Errorf("%w: a name of at most 100 characters and a purpose of at most 500 are required", errMCPArgs)
	}
	ceiling, set, err := a.agentCeiling(ctx, t.workspaceID)
	if err != nil {
		return nil, err
	}
	if !set {
		return nil, mcpSaid("The person has not said how much an assistant may let a new agent spend. They set it in Talyvor at " +
			a.cfg.publicBaseURL + "/settings/connect, then ask again.")
	}
	limits := map[string]int64{}
	for _, k := range agentLimits {
		n, _, err := ulxcArg(args, k)
		if err != nil {
			return nil, err
		}
		if n < 1 || n > ceiling.of(k) {
			return nil, mcpSaid(fmt.Sprintf("%s must be from 1 to %d µLXC, the most the person lets an assistant give a new agent.", k, ceiling.of(k)))
		}
		limits[k] = n
	}
	// UPSTREAM-BINDS-ONLY lensAgentCreateBody: colour, face, fiat_currency, owner_user_id, template, wallet_kind
	nameBody, _ := json.Marshal(map[string]string{"name": name})
	raw, err := a.lensOK(ctx, t, lensCall{method: http.MethodPost, path: lensWorkspacePath(t, "/agents"), body: nameBody})
	var agent map[string]any
	if err == nil {
		err = json.Unmarshal(raw, &agent)
	}
	if err != nil {
		return nil, err
	}
	id, _ := agent["id"].(string)
	if id == "" {
		return nil, fmt.Errorf("lens created an agent with no id: %v", agent)
	}
	path := lensWorkspacePath(t, "/agents/"+url.PathEscape(id))
	// UPSTREAM-BINDS-ONLY lensAgentUpdateBody: colour, face, name
	described, _ := json.Marshal(map[string]string{"description": purpose})
	_, err = a.lensOK(ctx, t, lensCall{method: http.MethodPatch, path: path, body: described})
	if err == nil {
		_, _, err = a.putAgentLimits(ctx, t, id, limits)
	}
	if err != nil {
		// A new agent's rules are no rules, so one whose limits were not saved stays paused until the person sets them.
		log.Printf("bff: mcp create_agent for client %q: agent %s made, its purpose or limits not saved: %v", g.ClientName, id, err)
		_, _, _ = a.mcpLens(ctx, t, lensCall{method: http.MethodPost, path: path + "/pause", body: pauseBody("Its starting limits were not saved")})
		return nil, mcpSaid("The agent " + name + " was made but its limits were not saved, so it is paused. The person sets its limits in Talyvor.")
	}
	agent["description"], agent["limits"] = purpose, limits
	return agent, nil
}

func (a *app) mcpSetAgentLimits(ctx context.Context, t tenant, _ oauthGrant, args mcpArgs) (map[string]any, error) {
	id, err := agentIDArg(args)
	if err != nil {
		return nil, err
	}
	asked := map[string]int64{}
	for _, k := range agentLimits {
		n, named, err := ulxcArg(args, k)
		if err != nil {
			return nil, err
		}
		if named {
			asked[k] = n
		}
	}
	applied, waiting, err := a.putAgentLimits(ctx, t, id, asked)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"agent_id": id, "applied": applied, "waiting": waiting}
	if len(waiting) > 0 {
		out["message"] = "A higher limit, or none, is not applied from the chat: the person raises it in Talyvor at " + a.cfg.publicBaseURL + "/agents."
	}
	return out, nil
}

// putAgentLimits reads the agent's rules and saves them with each asked limit that is lower than the one it has: zero is
// no limit, so any limit is lower than none. A higher one, or none, is left as it is and returned as waiting.
func (a *app) putAgentLimits(ctx context.Context, t tenant, agentID string, asked map[string]int64) (applied, waiting map[string]int64, err error) {
	// Lens's economy.AgentRules as Lens sent them, kept raw: every rule but the lowered limits goes back byte for byte,
	// including any this BFF does not know, so a limit set from the chat never erases another rule.
	var rules map[string]json.RawMessage
	path := lensWorkspacePath(t, "/agents/"+url.PathEscape(agentID)+"/rules")
	raw, err := a.lensOK(ctx, t, lensCall{method: http.MethodGet, path: path})
	if err == nil {
		err = json.Unmarshal(raw, &rules)
	}
	if err == nil && rules == nil {
		err = fmt.Errorf("lens answered no rules for agent %s", agentID)
	}
	if err != nil {
		return nil, nil, err
	}
	applied, waiting = map[string]int64{}, map[string]int64{}
	for _, k := range agentLimits {
		var cur int64 // absent or null is no limit
		if v, ok := rules[k]; ok {
			if err := json.Unmarshal(v, &cur); err != nil {
				return nil, nil, fmt.Errorf("lens answered %s as %s: %w", k, v, err)
			}
		}
		n, named := asked[k]
		switch {
		case !named || n == cur:
		case n > 0 && (cur == 0 || n < cur):
			applied[k], rules[k] = n, json.RawMessage(strconv.FormatInt(n, 10))
		default:
			waiting[k] = n
		}
	}
	if len(applied) == 0 {
		return applied, waiting, nil
	}
	body, _ := json.Marshal(rules)
	_, err = a.lensOK(ctx, t, lensCall{method: http.MethodPut, path: path, body: body})
	return applied, waiting, err
}

func (a *app) mcpIncomingRequests(ctx context.Context, t tenant, _ oauthGrant, _ mcpArgs) (map[string]any, error) {
	raw, err := a.lensOK(ctx, t, lensCall{method: http.MethodGet, path: lensWorkspacePath(t, "/money-requests")})
	var list map[string][]map[string]any
	if err == nil {
		err = json.Unmarshal(raw, &list)
	}
	if err != nil {
		return nil, err
	}
	incoming := []map[string]any{}
	for _, r := range list["requests"] {
		if r["to_workspace_id"] == t.workspaceID && r["status"] == "pending" {
			incoming = append(incoming, r)
		}
	}
	return map[string]any{"requests": incoming, "count": len(incoming)}, nil
}

// agentCeiling is the workspace's ceiling: memory first, then the table a restart left it in.
func (a *app) agentCeiling(ctx context.Context, workspaceID string) (connectCeiling, bool, error) {
	if c, ok := a.oauth.ceilings.Load(workspaceID); ok {
		return c.(connectCeiling), true, nil
	}
	c, ok, err := a.oauth.db.ceiling(ctx, workspaceID)
	if ok {
		a.oauth.ceilings.Store(workspaceID, c)
	}
	return c, ok, err
}

func (a *app) handleAgentCeiling(w http.ResponseWriter, r *http.Request, t tenant) {
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method {
	case http.MethodGet:
		c, set, err := a.agentCeiling(r.Context(), t.workspaceID)
		switch {
		case err != nil:
			log.Printf("bff: read the agent ceiling: %v", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "the limit could not be read; try again"})
		case !set:
			writeJSON(w, http.StatusOK, map[string]any{})
		default:
			writeJSON(w, http.StatusOK, c)
		}
	case http.MethodPut:
		var c connectCeiling
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		d.DisallowUnknownFields()
		if d.Decode(&c) != nil || c.MaxPerRequestULXC < 1 || c.DailyLimitULXC < 1 || c.MonthlyLimitULXC < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "each limit is a whole number of µLXC above 0"})
			return
		}
		if err := a.oauth.db.setCeiling(r.Context(), t.workspaceID, c); err != nil {
			log.Printf("bff: save the agent ceiling: %v", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "the limit was not saved; try again"})
			return
		}
		a.oauth.ceilings.Store(t.workspaceID, c)
		writeJSON(w, http.StatusOK, c)
	default:
		methodNotAllowed(w, "GET, PUT")
	}
}
