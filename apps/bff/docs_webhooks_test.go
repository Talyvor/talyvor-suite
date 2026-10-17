package main

import (
	"net/http"
	"testing"
)

// B39.24 — registering and removing a Docs webhook, and asking for a page's approval (docs_webhooks.go), reach the
// SESSION's workspace with the body untouched and the caller's identity, and Docs' refusal comes back as Docs said it.
func TestDocsWebhooks_CreateDeleteApprovalReachDocs(t *testing.T) {
	docs := newStatusUpstream(t, http.StatusCreated, `{"id":"wh-1","secret":"whsec_x"}`)
	a, sess := productApp(t, nil, docs)

	body := `{"url":"https://hooks.example.com/d","events":["approval.requested"]}`
	rec := cycleReq(t, a, sess, http.MethodPost, "/api/docs/webhooks", body)
	if rec.Code != http.StatusCreated || docs.method != http.MethodPost || docs.path != "/v1/workspaces/track-ws-7/webhooks" ||
		string(docs.reqBody) != body || docs.headers.Get("X-User-Email") == "" {
		t.Fatalf("create: %d, upstream got %s %s %s", rec.Code, docs.method, docs.path, docs.reqBody)
	}

	rec = cycleReq(t, a, sess, http.MethodGet, "/api/docs/webhooks", "")
	if docs.method != http.MethodGet || docs.path != "/v1/workspaces/track-ws-7/webhooks" {
		t.Fatalf("list: %d, upstream got %s %s", rec.Code, docs.method, docs.path)
	}

	rec = cycleReq(t, a, sess, http.MethodPost, "/api/docs/webhooks/wh-1/rotate", "")
	if docs.method != http.MethodPost || docs.path != "/v1/workspaces/track-ws-7/webhooks/wh-1/rotate" {
		t.Fatalf("rotate: %d, upstream got %s %s", rec.Code, docs.method, docs.path)
	}

	rec = cycleReq(t, a, sess, http.MethodDelete, "/api/docs/webhooks/wh-1", "")
	if docs.method != http.MethodDelete || docs.path != "/v1/workspaces/track-ws-7/webhooks/wh-1" {
		t.Fatalf("delete: %d, upstream got %s %s", rec.Code, docs.method, docs.path)
	}

	ask := `{"reviewers":["m-1"],"message":"please"}`
	rec = cycleReq(t, a, sess, http.MethodPost, "/api/docs/spaces/s1/pages/p1/approval", ask)
	if rec.Code != http.StatusCreated || docs.method != http.MethodPost || docs.path != "/v1/spaces/s1/pages/p1/approval" ||
		string(docs.reqBody) != ask || docs.headers.Get("X-User-Email") == "" {
		t.Fatalf("approval: %d, upstream got %s %s %s", rec.Code, docs.method, docs.path, docs.reqBody)
	}

	refused := newStatusUpstream(t, http.StatusBadRequest, `{"error":"url must be a public address","code":"BLOCKED_ADDRESS"}`)
	a, sess = productApp(t, nil, refused)
	rec = cycleReq(t, a, sess, http.MethodPost, "/api/docs/webhooks", `{"url":"https://127.0.0.1/x"}`)
	if rec.Code != http.StatusBadRequest || rec.Body.String() == "" {
		t.Fatalf("a refused create = %d %s, want Docs' 400 passed through", rec.Code, rec.Body.String())
	}
}
