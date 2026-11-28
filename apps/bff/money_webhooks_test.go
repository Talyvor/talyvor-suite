package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B28.74 — wallet webhooks are added, listed, rotated and removed, and their events read, through Lens's
// /v1/money/event-webhooks routes: only {url, events} goes up, the secret comes back once, and Lens's refusal of a URL
// it will not send to comes back in Lens's words.
func TestMoneyEventWebhooksReachLens(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = append(got, strings.TrimSpace(r.Method+" "+r.URL.RequestURI()+" "+string(raw)))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.Contains(string(raw), "http://"):
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"economy: webhook: the url must be https, on the public internet"}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/rotate"):
			_, _ = w.Write([]byte(`{"id":"wwh_1","url":"https://example.com/hook","events":[],"secret":"whsec_new"}`))
		case r.Method == http.MethodPost:
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"wwh_1","url":"https://example.com/hook","events":["transfer.created"],"secret":"whsec_x"}`))
		case r.Method == http.MethodDelete:
			_, _ = w.Write([]byte(`{"deleted":"wwh_1"}`))
		case r.URL.Path == "/v1/money/event-webhooks/events":
			_, _ = w.Write([]byte(`{"events":[{"id":"msg_1","webhook_id":"wwh_1","type":"transfer.created","status":"delivered"}]}`))
		default:
			_, _ = w.Write([]byte(`{"webhooks":[],"event_types":["transfer.created"]}`))
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/event-webhooks", `{"url":"https://example.com/hook","events":["transfer.created"],"by":"x"}`); rec.Code != http.StatusCreated ||
		!strings.Contains(rec.Body.String(), `"secret":"whsec_x"`) {
		t.Fatalf("add = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/event-webhooks", `{"url":"http://example.com/hook","events":[]}`); rec.Code != http.StatusBadRequest ||
		!strings.Contains(rec.Body.String(), "must be https, on the public internet") {
		t.Fatalf("http url = %d %s; want 400 in Lens's words", rec.Code, rec.Body.String())
	}
	for _, p := range []string{"/api/money/event-webhooks?workspace_id=ws_other", "/api/money/event-webhooks/events?workspace_id=ws_other"} {
		if rec := doJSON(a, http.MethodGet, p, ""); rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d %s", p, rec.Code, rec.Body.String())
		}
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/event-webhooks/wwh_1/rotate", ""); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), `"secret":"whsec_new"`) {
		t.Fatalf("rotate = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodDelete, "/api/money/event-webhooks/wwh_1", ""); rec.Code != http.StatusOK {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body.String())
	}
	want := []string{
		`POST /v1/money/event-webhooks {"url":"https://example.com/hook","events":["transfer.created"]}`,
		`POST /v1/money/event-webhooks {"url":"http://example.com/hook","events":[]}`,
		"GET /v1/money/event-webhooks",
		"GET /v1/money/event-webhooks/events",
		"POST /v1/money/event-webhooks/wwh_1/rotate",
		"DELETE /v1/money/event-webhooks/wwh_1",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens got %q; want %q", got, want)
	}
}
