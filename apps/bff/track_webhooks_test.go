package main

import (
	"net/http"
	"testing"
)

// B39.23 — registering and removing a Track webhook (track_webhooks.go) reaches the SESSION's
// workspace with the body untouched, and Track's refusal comes back as Track said it.
func TestTrackWebhooks_CreateDeleteReachTheSessionWorkspace(t *testing.T) {
	track := newStatusUpstream(t, http.StatusCreated, `{"id":"wh-1","secret":"whsec_x"}`)
	a, sess := productApp(t, track, nil)

	body := `{"url":"https://hooks.example.com/t","events":["issue.updated"]}`
	rec := cycleReq(t, a, sess, http.MethodPost, "/api/track/webhooks", body)
	if rec.Code != http.StatusCreated || track.method != http.MethodPost || track.path != "/v1/workspaces/track-ws-7/webhooks" ||
		string(track.reqBody) != body || track.headers.Get("X-User-Email") == "" {
		t.Fatalf("create: %d, upstream got %s %s %s", rec.Code, track.method, track.path, track.reqBody)
	}

	rec = cycleReq(t, a, sess, http.MethodDelete, "/api/track/webhooks/wh-1", "")
	if track.method != http.MethodDelete || track.path != "/v1/workspaces/track-ws-7/webhooks/wh-1" {
		t.Fatalf("delete: %d, upstream got %s %s", rec.Code, track.method, track.path)
	}

	refused := newStatusUpstream(t, http.StatusBadRequest, `{"error":"url must be an https:// URL","code":"BAD_URL"}`)
	a, sess = productApp(t, refused, nil)
	rec = cycleReq(t, a, sess, http.MethodPost, "/api/track/webhooks", `{"url":"http://x"}`)
	if rec.Code != http.StatusBadRequest || rec.Body.String() == "" {
		t.Fatalf("a refused create = %d %s, want Track's 400 passed through", rec.Code, rec.Body.String())
	}
}
