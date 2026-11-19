package main

import (
	"encoding/xml"
	"net/http"
	"strings"
)

// sitemapPages — B67.4: the public pages a search engine may list, as App.tsx routes them outside the sign-in gate.
// A signed-in route, sign-in itself and a shared link's token page are never here.
var sitemapPages = []string{
	"/marketing", "/pricing", "/your-money", "/documentation", "/documentation/claude", "/privacy", "/terms", "/signup",
}

// siteOrigin is the address the files name: the public origin when there is one, else the one the request came to
// (a loopback self-host has no public origin).
func (a *app) siteOrigin(r *http.Request) string {
	if a.cfg.publicBaseURL != "" {
		return strings.TrimRight(a.cfg.publicBaseURL, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// robotsTxt — B67.4: a real robots.txt, not the app's page. The API, sign-in and every shared link's token page are
// kept out of an index; the rest of the site points at the sitemap.
func (a *app) robotsTxt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	setMustRevalidate(w)
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter -- fixed text under text/plain, and every response carries nosniff (setSecurityHeaders)
	_, _ = w.Write([]byte("User-agent: *\n" +
		"Disallow: /api/\n" +
		"Disallow: /auth/\n" +
		"Disallow: /board/\n" +
		"Disallow: /share/\n" +
		"Disallow: /pay/\n" +
		"Disallow: /docs/s/\n" +
		"\n" +
		"Sitemap: " + a.siteOrigin(r) + "/sitemap.xml\n"))
}

// sitemapXML — B67.4: the public pages, as XML a search engine reads.
func (a *app) sitemapXML(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	origin := a.siteOrigin(r)
	for _, p := range sitemapPages {
		b.WriteString("  <url><loc>")
		_ = xml.EscapeText(&b, []byte(origin+p))
		b.WriteString("</loc></url>\n")
	}
	b.WriteString("</urlset>\n")
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	setMustRevalidate(w)
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter -- fixed XML under application/xml, the origin escaped, and every response carries nosniff (setSecurityHeaders)
	_, _ = w.Write([]byte(b.String()))
}
