package main

import "net/http"

// docs_branding.go — B39.34: Settings → Email branding sets how a Docs workspace's mail looks. Routes of
// talyvor-docs (B39.20's internal/email/branding.go), on the SESSION's workspace:
//
//	GET /api/docs/email-branding → GET /v1/workspaces/{ws}/email-branding  (any member)
//	PUT /api/docs/email-branding → PUT /v1/workspaces/{ws}/email-branding  {"from_name","header_color","logo_url"}
//
// Docs decides everything: PUT is owner only (403 otherwise), and a colour that is not #rrggbb or a logo that is not
// https is 400 with Docs' message, which Settings shows as it came. The body is forwarded verbatim.

const maxBrandingBody = 8 << 10 // Docs' own limit on this body.

func (a *app) docsEmailBranding() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPut {
			methodNotAllowed(w, "GET, PUT")
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
				docsWorkspacePath(ws, "/email-branding"), "", http.MethodGet, nil, nil)
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/email-branding"), "", http.MethodPut,
			http.MaxBytesReader(w, r.Body, maxBrandingBody), nil)
	})
}
