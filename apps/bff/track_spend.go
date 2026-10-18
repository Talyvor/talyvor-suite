package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"time"
)

// trackSpendInterval is how often one Track workspace asks Track to credit its Chat spend (B17.228). Track credits
// each request exactly once by its id, so a call too many costs a Lens read and nothing else.
const trackSpendInterval = 10 * time.Second

// trackSpendSync is what one call to Track's sync-spend needs, resolved from the session while the request is live.
type trackSpendSync struct {
	trackWS, email, sub, lensWS, token string
}

// trackSpendFor resolves the caller's Track workspace and Lens token, or false when there is nothing to sync or the
// workspace synced within trackSpendInterval.
func (a *app) trackSpendFor(r *http.Request) (trackSpendSync, bool) {
	if a.cfg.trackBaseURL == "" || a.auth == nil {
		return trackSpendSync{}, false
	}
	_, s, ok := a.auth.sessionAndIDFrom(r)
	if !ok || s.trackWorkspaceID == "" {
		return trackSpendSync{}, false
	}
	t, ok := a.tenantFrom(r)
	if !ok {
		return trackSpendSync{}, false
	}
	now := time.Now()
	if last, seen := a.trackSpendSynced.Swap(s.trackWorkspaceID, now); seen && now.Sub(last.(time.Time)) < trackSpendInterval {
		a.trackSpendSynced.Store(s.trackWorkspaceID, last)
		return trackSpendSync{}, false
	}
	return trackSpendSync{trackWS: s.trackWorkspaceID, email: s.email, sub: s.sub, lensWS: t.workspaceID, token: t.token}, true
}

// syncTrackSpend asks Track to add the caller's Lens spend to the issues it names (talyvor-track B17.242, POST
// /v1/workspaces/{wsID}/lens/sync-spend). Track's own Lens key reads only its own Lens workspace, so a Chat answer's
// charge never reached the issue it was about until the BFF handed over the session's Lens token. The token goes in
// X-Lens-Token and nowhere else. A failure is logged and changes nothing: the read it rides on must still answer.
func (a *app) syncTrackSpend(ctx context.Context, in trackSpendSync) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.trackBaseURL+trackWorkspacePath(in.trackWS, "/lens/sync-spend"), nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Gateway-Auth", a.cfg.trackGatewaySecret) // transit proof, server-side only
	req.Header.Set("X-User-Email", in.email)
	req.Header.Set("X-User-Id", in.sub)
	req.Header.Set("X-Auth-Iss", a.cfg.oidcIssuer)
	req.Header.Set("X-Talyvor-Workspace", in.lensWS) // Track records it as the workspace's Lens billing on first sight
	req.Header.Set("X-Lens-Token", in.token)
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: track sync-spend for %s: %v", in.trackWS, err)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		log.Printf("bff: track sync-spend for %s: returned %d", in.trackWS, resp.StatusCode)
	}
}
