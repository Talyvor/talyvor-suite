package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// B57.45 — the page an assistant opens to connect is Pocket's w-connect+consent-claude, server-rendered with no shell:
// who asks and as whom, what it will be able to do, that it never pays anything by itself, Cancel and Allow posting
// the answer as before; the could-not-connect page in the same card; the kit's small logo inline at 144 px.

func renderConnectPage(t *testing.T, p connectPage) string {
	t.Helper()
	rec := httptest.NewRecorder()
	writeConnectPage(rec, http.StatusOK, p)
	return rec.Body.String()
}

func carriesPocketsLogo(t *testing.T, page, body string) {
	t.Helper()
	for _, f := range []string{"talyvor-logo-small-on-dark.svg", "talyvor-logo-small-on-light.svg"} {
		logo, err := os.ReadFile("../web/public/brand/logo/" + f)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(body, string(logo)) {
			t.Errorf("%s does not carry %s inline, byte for byte", page, f)
		}
	}
	if !strings.Contains(body, "width: 144px") {
		t.Errorf("%s draws the logo at another width than 144px", page)
	}
	lower := strings.ToLower(body)
	for _, old := range []string{"#060a12", "#e6eef7", "#3ad6c0", "#0f7a6c", "space grotesk"} {
		if strings.Contains(lower, old) {
			t.Errorf("%s still uses the old brand's %s", page, old)
		}
	}
	for _, c := range []string{"#F3F4F6", "#FFFFFF", "#111216", "#4A5061", "#0F1013", "#181A1F", "#F2F3F5", "Figtree"} {
		if !strings.Contains(body, c) {
			t.Errorf("%s lacks Pocket's %s", page, c)
		}
	}
}

func TestConsentPage_IsPockets(t *testing.T) {
	body := renderConnectPage(t, connectPage{Client: "Claude", Email: "ada@example.com", Consent: "consent-1", ReturnTo: "claude.ai",
		Scopes: []string{"See your wallets and bills", "Draft invoices and payees", "Prepare payments for you to approve"}})

	for _, want := range []string{
		"<title>Connect Claude | Talyvor</title>",
		"<h1>Connect Claude to Talyvor</h1>",
		"Claude is asking to use your Talyvor workspace as <strong>ada@example.com</strong>. It will be able to:",
		"<li>See your wallets and bills</li><li>Draft invoices and payees</li><li>Prepare payments for you to approve</li>",
		"It can never pay anything by itself: every payment it prepares waits for you to approve it, unless a permission you signed covers it.",
		"After you choose, you go back to <strong>claude.ai</strong>.",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the consent page lacks %q", want)
		}
	}
	// Cancel and Allow answer the one consent by a POST to /oauth/authorize, as they always have; Cancel comes first.
	form := `<form method="post" action="/oauth/authorize">`
	consent := `<input type="hidden" name="consent" value="consent-1">`
	cancel := `<button class="btn secondary" type="submit" name="decision" value="deny">Cancel</button>`
	allow := `<button class="btn primary" type="submit" name="decision" value="allow">Allow</button>`
	at := -1
	for _, part := range []string{form, consent, cancel, allow} {
		i := strings.Index(body, part)
		if i < 0 {
			t.Fatalf("the consent page lacks %s:\n%s", part, body)
		}
		if i < at {
			t.Errorf("%s is out of order", part)
		}
		at = i
	}
	carriesPocketsLogo(t, "the consent page", body)
}

func TestConsentPage_CouldNotConnect(t *testing.T) {
	body := renderConnectPage(t, connectPage{Problem: "This request has expired or was already answered. Start again from your assistant."})
	for _, want := range []string{"<title>Could not connect | Talyvor</title>", "<h1>Could not connect</h1>",
		"<p>This request has expired or was already answered. Start again from your assistant.</p>"} {
		if !strings.Contains(body, want) {
			t.Errorf("the could-not-connect page lacks %q", want)
		}
	}
	if strings.Contains(body, "<form") {
		t.Error("the could-not-connect page offers an answer to a request it could not read")
	}
	carriesPocketsLogo(t, "the could-not-connect page", body)
}

// A client's name is what the client registered: the page escapes it.
func TestConsentPage_EscapesTheClientsName(t *testing.T) {
	body := renderConnectPage(t, connectPage{Client: `<img src=x onerror=alert(1)>`, Email: "ada@example.com", Consent: "c", ReturnTo: "claude.ai"})
	if strings.Contains(body, "<img") {
		t.Fatal("the consent page renders a client's name as markup")
	}
}
