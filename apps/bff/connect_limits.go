package main

// B52.3 — Talyvor Connect's rate limits and its audit trail.
//
// Each client IP is limited on /oauth/register, /oauth/authorize, /oauth/token and /mcp, and each connection (its
// grant) on /oauth/token's refreshes and on /mcp; a request over a limit is answered 429 with Retry-After. The
// register limit is also the cap on registrations that never complete a sign-in: an unused client is forgotten
// after oauthUnusedClientTTL, the same hour, so one address holds at most that many at once.
//
// Every tool call on /mcp is written to oauth_tool_calls (oauth_store.sql): the connection, the assistant's name,
// the tool, a SHA-256 of its arguments (never the arguments), the result and the time. The person reads it under
// Settings → Connected assistants (oauth_connected.go).

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

// connectLimit is one limit: at most max() requests per window for one key. The numbers are settings for
// Nicolai to confirm; the fallback holds until the variable is set.
type connectLimit struct {
	name     string
	setting  func() string
	fallback int
	window   time.Duration
}

var (
	limitRegisterIP = connectLimit{"register", func() string { return os.Getenv("BFF_CONNECT_REGISTER_PER_IP_HOUR") },
		10, oauthUnusedClientTTL}
	limitAuthorizeIP = connectLimit{"authorize", func() string { return os.Getenv("BFF_CONNECT_AUTHORIZE_PER_IP_MINUTE") },
		60, time.Minute}
	limitTokenIP = connectLimit{"token", func() string { return os.Getenv("BFF_CONNECT_TOKEN_PER_IP_MINUTE") },
		60, time.Minute}
	limitTokenGrant = connectLimit{"token-connection", func() string { return os.Getenv("BFF_CONNECT_TOKEN_PER_CONNECTION_MINUTE") },
		10, time.Minute}
	limitMCPIP = connectLimit{"mcp", func() string { return os.Getenv("BFF_CONNECT_MCP_PER_IP_MINUTE") },
		600, time.Minute}
	limitMCPGrant = connectLimit{"mcp-connection", func() string { return os.Getenv("BFF_CONNECT_MCP_PER_CONNECTION_MINUTE") },
		120, time.Minute}
)

func (l connectLimit) max() int {
	if n, err := strconv.Atoi(l.setting()); err == nil && n > 0 {
		return n
	}
	return l.fallback
}

// connectHits counts requests per limit and key in fixed windows. shortcut: in memory, so a restart forgets it
// and two BFFs count apart, like waitlistHits; move it to Postgres if the BFF ever runs more than one copy.
type connectHits struct {
	mu    sync.Mutex
	hits  map[string]connectHit
	swept time.Time
}

type connectHit struct {
	ends time.Time
	n    int
}

// take counts one request for key under l; over the limit it reports how long until the window ends.
func (c *connectHits) take(l connectLimit, key string, now time.Time) (time.Duration, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.hits == nil {
		c.hits = map[string]connectHit{}
	}
	if now.Sub(c.swept) >= time.Minute { // forget ended windows, so the map holds only live ones
		for k, h := range c.hits {
			if !now.Before(h.ends) {
				delete(c.hits, k)
			}
		}
		c.swept = now
	}
	k := l.name + " " + key
	h := c.hits[k]
	if !now.Before(h.ends) {
		h = connectHit{ends: now.Add(l.window)}
	}
	h.n++
	c.hits[k] = h
	return h.ends.Sub(now), h.n <= l.max()
}

// allow counts one request and, over the limit, answers 429 with Retry-After in whole seconds.
func (a *app) allow(w http.ResponseWriter, l connectLimit, key string) bool {
	wait, ok := a.oauth.hits.take(l, key, time.Now())
	if ok {
		return true
	}
	w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(wait.Seconds())))))
	oauthError(w, http.StatusTooManyRequests, "rate_limited", "too many requests; try again after the Retry-After seconds")
	return false
}

// perIP limits a route by its caller's address (Caddy's X-Forwarded-For entry, as the waitlist reads it).
func (a *app) perIP(l connectLimit, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.allow(w, l, waitlistClientIP(r)) {
			next(w, r)
		}
	}
}

// assistantCall is one row of the audit trail as Settings shows it.
type assistantCall struct {
	Tool       string    `json:"tool"`
	ArgsSHA256 string    `json:"args_sha256"`
	Result     string    `json:"result"` // done | refused (the tool said no) | failed (the call itself was invalid)
	At         time.Time `json:"at"`
}

// auditToolCall writes one tools/call and how it ended. A failed write is logged, never the caller's problem:
// the call has already happened by then.
func (a *app) auditToolCall(ctx context.Context, g oauthGrant, req mcpMessage, resp mcpResponse) {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	_ = json.Unmarshal(req.Params, &p)
	c := assistantCall{Tool: p.Name, ArgsSHA256: tokenKey(string(p.Arguments)), Result: "done", At: time.Now()}
	if len(c.Tool) > 100 {
		c.Tool = c.Tool[:100]
	}
	if resp.Error != nil {
		c.Result = "failed"
	} else if m, ok := resp.Result.(map[string]any); ok && m["isError"] == true {
		c.Result = "refused"
	}
	if a.oauth.db == nil {
		a.oauth.grants.update(g.ID, func(g oauthGrant) oauthGrant {
			g.calls = append([]assistantCall{c}, g.calls[:min(len(g.calls), connectedCallsShown-1)]...)
			return g
		})
		return
	}
	if err := a.oauth.db.recordToolCall(context.WithoutCancel(ctx), g, c); err != nil {
		log.Printf("bff: mcp audit of %s for client %q: %v", c.Tool, g.ClientName, err)
	}
}
