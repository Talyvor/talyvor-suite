package main

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestAppPageCarriesSecurityHeaders — B28.247: an app page (a client route, answered with index.html) cannot be
// framed and names its CSP and referrer policy.
func TestAppPageCarriesSecurityHeaders(t *testing.T) {
	rec := getPath(t, newFallbackApp(t, fallbackFixture{}), "/ledger")
	if !servedTheApp(rec) {
		t.Fatalf("GET /ledger: %d %q is not the app's page", rec.Code, rec.Body.String())
	}
	for name, want := range map[string]string{
		"Content-Security-Policy": "frame-ancestors 'none'",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "same-origin",
		"X-Content-Type-Options":  "nosniff",
	} {
		if got := rec.Header().Get(name); !strings.Contains(got, want) {
			t.Errorf("%s: %q, want it to carry %q", name, got, want)
		}
	}
}

// TestAppPageScriptsAreItsOwn — B28.454: an app page runs scripts from the app's files and, inline, only the ones its
// index.html wrote, by hash; never 'unsafe-inline'.
func TestAppPageScriptsAreItsOwn(t *testing.T) {
	const theme = "document.documentElement.setAttribute('data-theme', 'dark')"
	dist := t.TempDir()
	page := `<!doctype html><title>app</title><script>` + theme + `</script><script type="module" src="/assets/index-HASH1.js"></script>`
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	a := newApp(config{lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret, webDist: dist, authMode: authModeDisabled}, nil)
	sum := sha256.Sum256([]byte(theme))
	want := "script-src 'self' 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "';"
	for _, path := range []string{"/ledger", "/"} {
		rec := getPath(t, a, path)
		if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, want) || !strings.Contains(csp, "default-src 'self'") {
			t.Errorf("GET %s: CSP %q, want default-src 'self' and %q", path, csp, want)
		}
	}
}

// TestCanvasIsItsOwnDocument — B28.454: the chat canvas's page is sandboxed with no origin and framed only by the app.
func TestCanvasIsItsOwnDocument(t *testing.T) {
	rec := getPath(t, newFallbackApp(t, fallbackFixture{}), "/canvas")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "talyvor-canvas-ready") {
		t.Fatalf("GET /canvas: %d %q is not the canvas page", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Security-Policy"); got != "sandbox allow-scripts; frame-ancestors 'self'" {
		t.Errorf("Content-Security-Policy: %q", got)
	}
	if got := rec.Header().Get("X-Frame-Options"); got != "SAMEORIGIN" {
		t.Errorf("X-Frame-Options: %q", got)
	}
}

// TestPublicSitePolicyAddsOnlyMeta — B44.2: talyvor.com's public pages may load Meta's pixel, and nothing else changes:
// take the two Meta hosts back out and what is left is the app's policy, which every other page keeps byte for byte.
func TestPublicSitePolicyAddsOnlyMeta(t *testing.T) {
	const theme = "document.documentElement.setAttribute('data-theme', 'dark')"
	dist := t.TempDir()
	page := `<!doctype html><title>app</title><script>` + theme + `</script><script type="module" src="/assets/index-HASH1.js"></script>`
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	a := newApp(config{lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret, webDist: dist, authMode: authModeDisabled}, nil)
	today := appPagePolicy([]byte(page))
	for _, path := range []string{"/", "/ledger", "/signin", "/settings/terms", "/share/abc", "/pay/abc", "/marketingx", "/pricing/x"} {
		if got := getPath(t, a, path).Header().Get("Content-Security-Policy"); got != today {
			t.Errorf("GET %s: CSP %q, want today's %q", path, got, today)
		}
	}
	for _, path := range []string{"/marketing", "/marketing/", "/pricing", "/documentation", "/documentation/wallets", "/signup", "/privacy", "/terms"} {
		got := getPath(t, a, path).Header().Get("Content-Security-Policy")
		if !strings.Contains(got, "script-src 'self' https://connect.facebook.net ") ||
			!strings.HasSuffix(got, "; connect-src 'self' https://www.facebook.com https://connect.facebook.net") {
			t.Errorf("GET %s: CSP %q does not allow Meta's script and events", path, got)
		}
		stripped := strings.NewReplacer(" https://connect.facebook.net", "", " https://www.facebook.com", "").Replace(got)
		if stripped != today+"; connect-src 'self'" {
			t.Errorf("GET %s: CSP without Meta's hosts is %q, want today's %q plus connect-src 'self'", path, stripped, today)
		}
	}
}
