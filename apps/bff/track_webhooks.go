package main

import (
	"net/http"
	"net/url"
)

// track_webhooks.go — B39.23: a person registers and removes a webhook on their Track workspace from
// the suite. Two routes of talyvor-track's internal/webhooks/handler.go (B39.13), on the SESSION's
// workspace:
//
//	POST   /api/track/webhooks       → POST   /v1/workspaces/{ws}/webhooks       {"url", "events"}
//	DELETE /api/track/webhooks/{id}  → DELETE /v1/workspaces/{ws}/webhooks/{id}
//
// Track decides everything: owner only (403 otherwise), an https URL on a public address (400
// BAD_URL / BLOCKED_ADDRESS), and the whsec_ secret in the create answer, shown once. The body is
// forwarded verbatim, like the issue create.

const maxWebhookBody = 4 << 10

func (a *app) trackCreateWebhook() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/webhooks"), "", http.MethodPost,
			http.MaxBytesReader(w, r.Body, maxWebhookBody), nil)
	})
}

func (a *app) trackDeleteWebhook() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			methodNotAllowed(w, http.MethodDelete)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/webhooks/"+url.PathEscape(id)), "", http.MethodDelete, nil, nil)
	})
}
