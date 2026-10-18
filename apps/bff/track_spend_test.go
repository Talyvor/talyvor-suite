package main

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// TestTrackIssueDetail_CreditsChatSpendFirst (B17.228): reading an issue first asks Track to credit the caller's
// Lens spend, with the session's Lens token and Lens workspace, and a second read inside trackSpendInterval does not.
func TestTrackIssueDetail_CreditsChatSpendFirst(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	var token, lensWS string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		seen = append(seen, r.Method+" "+r.URL.Path)
		if r.URL.Path == "/v1/workspaces/track-ws-7/lens/sync-spend" {
			token, lensWS = r.Header.Get("X-Lens-Token"), r.Header.Get("X-Talyvor-Workspace")
			_, _ = w.Write([]byte(`{"attributed":1}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"isu-1","ai_cost_usd":0.004091}`))
	}))
	t.Cleanup(srv.Close)
	a, sess := productApp(t, &captureUpstream{srv: srv}, nil)

	for range 2 {
		if rec := trackGET(t, a, sess, "/api/track/issues/isu-1"); rec.Code != http.StatusOK {
			t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
		}
	}
	want := []string{"POST /v1/workspaces/track-ws-7/lens/sync-spend", "GET /v1/workspaces/track-ws-7/issues/isu-1", "GET /v1/workspaces/track-ws-7/issues/isu-1"}
	if len(seen) != len(want) || seen[0] != want[0] || seen[1] != want[1] || seen[2] != want[2] {
		t.Fatalf("Track saw %q, want %q", seen, want)
	}
	if token != "jwt-for-u-test-workspace" || lensWS != "u-test-workspace" {
		t.Fatalf("sync-spend carried token %q and Lens workspace %q, want the session's", token, lensWS)
	}
}
