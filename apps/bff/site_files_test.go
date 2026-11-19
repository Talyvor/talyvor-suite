package main

import (
	"strings"
	"testing"
)

// TestEveryResponsePinsHTTPSAndTurnsOffUnusedFeatures — B67.4: the BFF itself sets HSTS and a Permissions-Policy, so
// they no longer depend on the front door's Caddy file (the live one, in talyvor-lens, sets neither). The passkey
// prompt and Chat's microphone stay allowed on the app's own origin.
func TestEveryResponsePinsHTTPSAndTurnsOffUnusedFeatures(t *testing.T) {
	a := newFallbackApp(t, fallbackFixture{})
	for _, path := range []string{"/marketing", "/ledger", "/api/nope", "/robots.txt"} {
		rec := getPath(t, a, path)
		if got := rec.Header().Get("Strict-Transport-Security"); got != "max-age=31536000" {
			t.Errorf("GET %s: Strict-Transport-Security %q, want max-age=31536000", path, got)
		}
		pp := rec.Header().Get("Permissions-Policy")
		for _, want := range []string{"camera=()", "geolocation=()", "payment=()", "microphone=(self)",
			"publickey-credentials-get=(self)", "publickey-credentials-create=(self)"} {
			if !strings.Contains(pp, want) {
				t.Errorf("GET %s: Permissions-Policy %q, want it to carry %q", path, pp, want)
			}
		}
	}
}

// TestRobotsAndSitemapAreFilesNotTheApp — B67.4: /robots.txt is text and /sitemap.xml is XML listing the public
// pages only, never the app's HTML and never a signed-in route.
func TestRobotsAndSitemapAreFilesNotTheApp(t *testing.T) {
	a := newFallbackApp(t, fallbackFixture{})
	a.cfg.publicBaseURL = "https://app.example.test"

	robots := getPath(t, a, "/robots.txt")
	if ct := robots.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") || robots.Code != 200 {
		t.Fatalf("GET /robots.txt: %d %q, want 200 text/plain", robots.Code, ct)
	}
	if body := robots.Body.String(); !strings.HasPrefix(body, "User-agent: *\n") ||
		!strings.Contains(body, "Disallow: /api/\n") ||
		!strings.Contains(body, "Sitemap: https://app.example.test/sitemap.xml\n") {
		t.Errorf("robots.txt:\n%s", body)
	}

	sm := getPath(t, a, "/sitemap.xml")
	if ct := sm.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/xml") || sm.Code != 200 {
		t.Fatalf("GET /sitemap.xml: %d %q, want 200 application/xml", sm.Code, ct)
	}
	body := sm.Body.String()
	if !strings.HasPrefix(body, `<?xml version="1.0" encoding="UTF-8"?>`) {
		t.Errorf("sitemap.xml starts %q", body[:min(len(body), 60)])
	}
	for _, p := range []string{"/marketing", "/pricing", "/your-money", "/documentation", "/documentation/claude", "/privacy", "/terms", "/signup"} {
		if !strings.Contains(body, "<loc>https://app.example.test"+p+"</loc>") {
			t.Errorf("sitemap.xml does not list %s", p)
		}
	}
	if n := strings.Count(body, "<loc>"); n != 8 {
		t.Errorf("sitemap.xml lists %d pages, want the 8 public ones:\n%s", n, body)
	}
	for _, p := range []string{"/ledger", "/agents", "/signin", "/share/", "/pay/"} {
		if strings.Contains(body, "app.example.test"+p) {
			t.Errorf("sitemap.xml lists the signed-in or private route %s", p)
		}
	}
}
