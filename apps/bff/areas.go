package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// areas.go — B59.2: a hidden area is not there.
//
// A workspace has an area (marketplace, rooms, chat, …) only once the operator switches it on in
// Lens (talyvor-lens B59.1, GET /v1/workspaces/{ws}/areas). Until then every BFF route of that area
// answers the same 404 as a route that does not exist, and the web draws nothing for it.
// The web reads the same list from GET /api/workspace/areas (workspace_areas.go, B59.38).
//
// ⚠ THE GATE RUNS IN ServeHTTP, BEFORE THE MUX, for the same reason the Origin gate does: one rule
// in one place. A per-handler check would be missed by the next route somebody adds to rooms.go.
//
// ⚠ IT FAILS CLOSED. When Lens cannot say which areas the workspace has, a hidden-area route
// answers 404: the area is off by default, so "unknown" is "off".
//
// A request with no session or no workspace is not gated here: the handler answers it 401 or 409
// exactly as it answers an unknown /api/* route, so the answer names no area either way. The
// public share links (/api/public/*, /docs/s/, /share/) have no workspace to ask and stay as they
// are, like Lens's own /v1/public/* routes.

// knownAreas is Lens's internal/areas.All. A name outside it, from Lens or anywhere, is dropped.
var knownAreas = map[string]bool{
	"marketplace": true, "rooms": true, "chat": true, "track": true, "docs": true, "code": true,
	"edge": true, "desktop": true, "scan": true, "counter": true, "trading": true, "credit": true,
	"interest": true, "prediction_markets": true, "gateway": true,
}

// areaRoutes maps each BFF path to the area it belongs to. An entry ending in "/" covers every
// path under it; any other entry covers that path and every path under it.
var areaRoutes = []struct{ prefix, area string }{
	{"/api/marketplace/", "marketplace"},
	{"/api/rooms", "rooms"},
	{"/api/room-invites/", "rooms"},
	{"/api/chat/", "chat"},
	{"/api/documents", "chat"}, // the files a chat attaches (documents.go)
	{"/api/docs/", "docs"},
	{"/api/track/", "track"},
	{"/api/scan/", "scan"},
	{"/api/wallets/loans", "credit"},
	// The old gateway's own management routes. The model routes agents call are not here.
	{"/api/distill", "gateway"},
	{"/api/routing/", "gateway"},
	{"/api/models", "gateway"}, // Lens's /v1/catalog
	{"/api/features/stored-answers", "gateway"},
	{"/api/features/tare", "gateway"}, // and tare-model, tare-training, tare-savings, tare/preview
	{"/api/features/cost-optimize-routing", "gateway"},
	{"/api/features/distill-poolable", "gateway"},
	{"/api/features/guardrails", "gateway"},
}

// areaOfPath names the area a request path belongs to, or "" when it belongs to none.
func areaOfPath(path string) string {
	for _, e := range areaRoutes {
		if strings.HasSuffix(e.prefix, "/") {
			if strings.HasPrefix(path, e.prefix) {
				return e.area
			}
			continue
		}
		if path == e.prefix || strings.HasPrefix(path, e.prefix+"/") || strings.HasPrefix(path, e.prefix+"-") {
			return e.area
		}
	}
	return ""
}

// areasReader is how newApp gives each app its read of a workspace's areas: Lens's list. The
// package's tests open every area here (areas_main_test.go), because they test each area as it
// behaves once switched on; the gate's own tests put this read back.
var areasReader = func(a *app) func(context.Context, tenant) ([]string, error) { return a.workspaceAreas }

// workspaceAreas reads the areas the workspace has from Lens, keeping only names Lens defines.
func (a *app) workspaceAreas(ctx context.Context, t tenant) ([]string, error) {
	raw, err := a.lensGet(ctx, t, lensWorkspacePath(t, "/areas"))
	if err != nil {
		return nil, err
	}
	var body struct {
		Areas *[]string `json:"areas"`
	}
	if err := json.Unmarshal(raw, &body); err != nil || body.Areas == nil {
		return nil, fmt.Errorf("areas: the reply does not list areas")
	}
	out := []string{}
	for _, name := range *body.Areas {
		if knownAreas[name] {
			out = append(out, name)
		}
	}
	return out, nil
}

// areaHidden reports whether the request is for an area its workspace does not have. It answers
// false when the path is in no area, or when there is no workspace to ask (see the header).
func (a *app) areaHidden(r *http.Request) bool {
	area := areaOfPath(r.URL.Path)
	if area == "" {
		return false
	}
	t, ok := a.tenantFrom(r)
	if !ok {
		return false
	}
	has, err := a.areas(r.Context(), t)
	if err != nil {
		return true
	}
	for _, name := range has {
		if name == area {
			return false
		}
	}
	return true
}
