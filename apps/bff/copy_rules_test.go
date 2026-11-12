package main

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
)

// B56.25 — the pages the BFF draws itself follow the same copy rules as the web app (apps/web/src/copyRules.ts):
// no em or en dash and none of the forbidden words. The BFF sends no email; these two pages are all it writes
// for a person to read. Their <style> and the embedded logo are not words and are left out.
var copyForbidden = []*regexp.Regexp{
	regexp.MustCompile(`[\x{2013}\x{2014}]`),
	regexp.MustCompile(`(?i)\bmixt\b|mixtet|moldovagaz|banking|agent bank|closed trial|test money|test credits`),
	regexp.MustCompile(`(?i)\bUS first\b|then the UK and the EU|licensed partners?|illustration|coming soon`),
	regexp.MustCompile(`(?i)nicolai gaborac|first \$1 ?m(illion)?\b|100% of[^.]*\b(sellers?|sales?|first)\b`),
}

var notWords = regexp.MustCompile(`(?s)<style>.*?</style>|<svg.*?</svg>`)

func TestCopyRules_BFFPages(t *testing.T) {
	pages := map[string]func(http.ResponseWriter){
		"denied, with an email": func(w http.ResponseWriter) { writeDeniedPage(w, "someone@example.com") },
		"denied, with no email": func(w http.ResponseWriter) { writeDeniedPage(w, "") },
		"connect": func(w http.ResponseWriter) {
			writeConnectPage(w, 200, connectPage{Client: "Claude", Email: "someone@example.com", Scopes: oauthScopeNames()})
		},
		"connect, with a problem": func(w http.ResponseWriter) {
			writeConnectPage(w, 400, connectPage{Client: "Claude", Problem: "This link has expired."})
		},
	}
	for name, draw := range pages {
		rec := httptest.NewRecorder()
		draw(rec)
		text := notWords.ReplaceAllString(rec.Body.String(), "")
		for _, re := range copyForbidden {
			if m := re.FindString(text); m != "" {
				t.Errorf("%s page says %q", name, m)
			}
		}
	}
}
