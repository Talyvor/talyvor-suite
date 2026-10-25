package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B44.1 — talyvor.com's waitlist: a stranger joins through Lens on the provision secret; only the operator reads it.

func waitlistApp(t *testing.T) (*app, *http.Cookie, *http.Cookie, *[]map[string]string) {
	t.Helper()
	posted := &[]map[string]string{}
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/waitlist" && r.Header.Get(provisionSecretHeader) == testProvisionSecret:
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			*posted = append(*posted, body)
			_, _ = io.WriteString(w, `{"stored":true,"ref_code":"k3m7q2xa9b"}`)
		case r.Method == http.MethodGet && r.URL.Path == "/v1/admin/waitlist" && r.Header.Get("Authorization") == "Bearer op-read-key":
			_, _ = io.WriteString(w, `{"signups":[`+
				`{"email":"ann@example.com","created_at":"2026-10-23T20:00:00Z","page":"/marketing","utm_source":"meta","utm_medium":null,"utm_campaign":"=launch","ref_code":"k3m7q2xa9b","referrals":2},`+
				`{"email":"probe-1@e2e.talyvor.test","created_at":"2026-10-23T21:00:00Z","page":"/signup"}]}`)
		default:
			w.WriteHeader(http.StatusForbidden)
		}
	}))
	t.Cleanup(lens.Close)
	a, op, user := operatorApp(t, []string{"sub-operator"})
	a.cfg.lensBaseURL = lens.URL
	a.cfg.operatorReadKey = "op-read-key"
	return a, op, user, posted
}

func joinWaitlist(a *app, ip, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/waitlist", strings.NewReader(body))
	req.Header.Set("Origin", opOrigin)
	req.Header.Set("X-Forwarded-For", ip)
	a.ServeHTTP(rec, req)
	return rec
}

func TestWaitlist_JoinSendsTheNormalisedEmailToLensOnTheProvisionSecret(t *testing.T) {
	a, _, _, posted := waitlistApp(t)
	for _, email := range []string{"  Ann@Example.com ", "ann@example.com"} {
		rec := joinWaitlist(a, "203.0.113.1", `{"email":"`+email+`","page":"/marketing","utm_source":"meta","utm_campaign":"oct"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("join %q: %d %s", email, rec.Code, rec.Body.String())
		}
	}
	// Lens's UNIQUE(email) keeps one row because both arrive identical (B44.6 asserts the row).
	if len(*posted) != 2 || (*posted)[0]["email"] != "ann@example.com" || (*posted)[1]["email"] != "ann@example.com" ||
		(*posted)[0]["page"] != "/marketing" || (*posted)[0]["utm_source"] != "meta" || (*posted)[0]["utm_campaign"] != "oct" {
		t.Fatalf("Lens was sent %v", *posted)
	}
	for k := range (*posted)[0] {
		if k != "email" && k != "page" && k != "ref" && !strings.HasPrefix(k, "utm_") {
			t.Fatalf("Lens was sent a %q field: %v", k, (*posted)[0])
		}
	}
}

// B45.21 — the referrer's code goes to Lens (anything not shaped like a code is dropped), and the joiner gets their own back.
func TestWaitlist_JoinForwardsTheRefAndAnswersWithTheJoinersOwnCode(t *testing.T) {
	a, _, _, posted := waitlistApp(t)
	for _, c := range []struct{ ref, sent string }{{" AbCd234567 ", "abcd234567"}, {"x'; drop", ""}, {"", ""}} {
		rec := joinWaitlist(a, "203.0.113.3", `{"email":"bea@example.com","ref":"`+c.ref+`"}`)
		var out struct {
			OK      bool   `json:"ok"`
			RefCode string `json:"ref_code"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if rec.Code != http.StatusOK || !out.OK || out.RefCode != "k3m7q2xa9b" {
			t.Fatalf("ref %q: %d %s", c.ref, rec.Code, rec.Body.String())
		}
		if got := (*posted)[len(*posted)-1]["ref"]; got != c.sent {
			t.Fatalf("ref %q: Lens was sent ref %q, want %q", c.ref, got, c.sent)
		}
	}
}

func TestWaitlist_HoneypotAndBadEmailStoreNothing(t *testing.T) {
	a, _, _, posted := waitlistApp(t)
	if rec := joinWaitlist(a, "203.0.113.2", `{"email":"bot@example.com","website":"http://spam"}`); rec.Code != http.StatusOK {
		t.Fatalf("honeypot: %d %s", rec.Code, rec.Body.String())
	}
	for _, bad := range []string{"no-at.example.com", "a@b@example.com", "a@localhost", strings.Repeat("a", 250) + "@x.com"} {
		if rec := joinWaitlist(a, "203.0.113.2", `{"email":"`+bad+`"}`); rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: %d %s", bad, rec.Code, rec.Body.String())
		}
	}
	if len(*posted) != 0 {
		t.Fatalf("Lens was sent %v", *posted)
	}
}

func TestWaitlist_SixthSubmitFromOneIPInAnHourIs429(t *testing.T) {
	a, _, _, _ := waitlistApp(t)
	for i := 1; i <= 6; i++ {
		rec := joinWaitlist(a, "10.0.0.1, 198.51.100.7", `{"email":"p`+string(rune('0'+i))+`@example.com"}`)
		if want := map[bool]int{true: http.StatusOK, false: http.StatusTooManyRequests}[i <= 5]; rec.Code != want {
			t.Fatalf("submit %d: %d, want %d", i, rec.Code, want)
		}
	}
	if rec := joinWaitlist(a, "198.51.100.8", `{"email":"other@example.com"}`); rec.Code != http.StatusOK {
		t.Fatalf("another IP: %d", rec.Code)
	}
}

func TestWaitlist_CSVIsTheOperatorsOnly(t *testing.T) {
	a, op, user, _ := waitlistApp(t)
	get := func(sess *http.Cookie, bearer string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/waitlist", nil)
		if sess != nil {
			req.AddCookie(sess)
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		a.ServeHTTP(rec, req)
		return rec
	}
	if rec := get(nil, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", rec.Code)
	}
	if rec := get(nil, "wrong"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong key: %d", rec.Code)
	}
	if rec := get(user, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("non-operator: %d", rec.Code)
	}
	want := "email,created_at,page,utm_source,utm_medium,utm_campaign,ref_code,referrals\n" +
		"ann@example.com,2026-10-23T20:00:00Z,/marketing,meta,,'=launch,k3m7q2xa9b,2\n" +
		"# left out: 1 nightly tester signups (@e2e.talyvor.test)\n"
	for name, rec := range map[string]*httptest.ResponseRecorder{"operator": get(op, ""), "operator key": get(nil, "op-read-key")} {
		if rec.Code != http.StatusOK || rec.Body.String() != want || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/csv") {
			t.Fatalf("%s: %d %q", name, rec.Code, rec.Body.String())
		}
	}
}
