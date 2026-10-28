package main

import (
	"crypto/sha256"
	"encoding/base64"
	"mime"
	"net/http"
	"regexp"
	"strings"
)

// B28.247 — on every response, the app's pages included: no other site may frame it, an injected <base> or plugin
// cannot load, a form posts only here, and a link out sends no address from inside the app.
//
// B28.454 — and a script runs only from the app's own files, or inline where index.html itself wrote it (by hash,
// appPagePolicy): a script injected into a page does not run. The chat canvas, which exists to run a model's
// scripts, draws in its own document with its own policy (canvas.go). Styles stay 'unsafe-inline': the sign-in and
// marketing pages, KaTeX and Mermaid all write inline styles. Images may come from any https: address, as an
// answer's or a Docs page's pictures do.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob: https:; font-src 'self' data:; " +
	"frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"

func setSecurityHeaders(h http.Header) {
	h.Set("Content-Security-Policy", contentSecurityPolicy)
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "same-origin")
	// B42.5 — a body relayed from Lens is never sniffed into HTML: it is only ever what its Content-Type says.
	h.Set("X-Content-Type-Options", "nosniff")
}

// relayContentType — B50.6: a body relayed from Lens, Track or Docs (an uploaded file, an export) is never a page or a
// script on the app's origin. It keeps its upstream type, never one Go sniffs from the bytes, and a type a browser
// would render or run is a download (the upstream's own attachment filename kept).
func relayContentType(w, upstream http.Header) {
	ct := upstream.Get("Content-Type")
	mt, _, err := mime.ParseMediaType(ct)
	if err != nil { // none, or one a browser might read differently from Go: an opaque download either way
		ct, mt = "application/octet-stream", ""
	}
	w.Set("Content-Type", ct)
	if mt == "text/html" || strings.HasSuffix(mt, "xml") || strings.Contains(mt, "javascript") {
		cd := upstream.Get("Content-Disposition")
		if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(cd)), "attachment") {
			cd = "attachment"
		}
		w.Set("Content-Disposition", cd)
	}
}

// inlineScript is a <script> element and its text; one with a src= is a file, which 'self' already covers.
var inlineScript = regexp.MustCompile(`(?s)<script([^>]*)>(.*?)</script>`)

// appPagePolicy is the policy for index.html as served: its own inline scripts allowed by hash. It is read from the
// page on disk, not written here, so the bundle and the BFF — deployed apart — cannot disagree about it.
func appPagePolicy(page []byte) string {
	var hashes strings.Builder
	for _, m := range inlineScript.FindAllSubmatch(page, -1) {
		if strings.Contains(string(m[1]), "src=") {
			continue
		}
		sum := sha256.Sum256(m[2])
		hashes.WriteString(" 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'")
	}
	return strings.Replace(contentSecurityPolicy, "script-src 'self'", "script-src 'self'"+hashes.String(), 1)
}

// B44.2 — talyvor.com's public pages may load Meta's pixel once the visitor accepts it: its script from
// connect.facebook.net, its events to www.facebook.com. Every other page, the app's included, keeps the policy above.
func isPublicSitePath(p string) bool {
	switch p {
	case "/pricing", "/signup", "/privacy", "/terms", "/marketing", "/documentation":
		return true
	}
	return strings.HasPrefix(p, "/marketing/") || strings.HasPrefix(p, "/documentation/")
}

func publicSitePolicy(policy string) string {
	return strings.Replace(policy, "script-src 'self'", "script-src 'self' https://connect.facebook.net", 1) +
		"; connect-src 'self' https://www.facebook.com https://connect.facebook.net"
}
