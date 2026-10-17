package main

import (
	"net/http"
	"net/url"
)

// docs_webhooks.go — B39.24: a person registers and removes a webhook on their Docs workspace, and asks for a
// page's approval, from the suite; B39.25 adds the list and the rotate Settings → Webhooks needs. Routes of
// talyvor-docs (B39.14's internal/webhooks/handler.go and internal/approval/handler.go), on the SESSION's workspace:
//
//	GET    /api/docs/webhooks                                  → GET    /v1/workspaces/{ws}/webhooks
//	POST   /api/docs/webhooks                                  → POST   /v1/workspaces/{ws}/webhooks       {"url", "events"}
//	POST   /api/docs/webhooks/{id}/rotate                      → POST   /v1/workspaces/{ws}/webhooks/{id}/rotate
//	DELETE /api/docs/webhooks/{id}                             → DELETE /v1/workspaces/{ws}/webhooks/{id}
//	POST   /api/docs/spaces/{spaceID}/pages/{pageID}/approval  → POST   /v1/spaces/{s}/pages/{p}/approval {"reviewers", "message"}
//
// Docs decides everything: webhooks are owner only (403 otherwise), an https URL on a public address (400 BAD_URL /
// BLOCKED_ADDRESS), the whsec_ secret in the create and rotate answers only, never on the list; asking for approval needs edit on the page,
// and Docs takes the workspace from the page, never the body. Bodies are forwarded verbatim, like Track's (B39.23).

func (a *app) docsWebhooks() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, "GET, POST")
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
				docsWorkspacePath(ws, "/webhooks"), "", http.MethodGet, nil, nil)
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/webhooks"), "", http.MethodPost,
			http.MaxBytesReader(w, r.Body, maxWebhookBody), nil)
	})
}

func (a *app) docsRotateWebhook() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/webhooks")+"/"+url.PathEscape(id)+"/rotate", "", http.MethodPost, nil, nil)
	})
}

func (a *app) docsDeleteWebhook() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			methodNotAllowed(w, http.MethodDelete)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/webhooks")+"/"+url.PathEscape(id), "", http.MethodDelete, nil, nil)
	})
}

func (a *app) docsRequestApproval() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		spaceID, ok := pathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		pageID, ok := pathID(w, "pageID", r.PathValue("pageID"))
		if !ok {
			return
		}
		if _, ok := a.docsWorkspaceFor(w, r); !ok {
			return
		}
		body, ok := docsRelayBody(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID)+"/approval", "", http.MethodPost, body, nil)
	})
}
