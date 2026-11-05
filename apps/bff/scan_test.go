package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B52.28 — the reports and the track record reach Lens's public routes with no credential; a watch reaches the agent's own route with
// only its series, rule and z; the list and a stop reach the workspace's watches.
func TestScanReachesLensWithOnlyItsFields(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.RequestURI()+" auth="+r.Header.Get("Authorization")+" "+string(b))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	doJSON(a, http.MethodGet, "/api/scan/track-record", "")
	doJSON(a, http.MethodPost, "/api/agents/agt_1/scan-watches", `{"series":["eia.stocks.cushing-crude"],"rule":"z","z":2,"workspace_id":"ws_other"}`)
	doJSON(a, http.MethodGet, "/api/scan/watches", "")
	doJSON(a, http.MethodDelete, "/api/scan/watches/swt_1", "")
	doJSON(a, http.MethodGet, "/api/scan/reports?family=oil", "")
	doJSON(a, http.MethodGet, "/api/scan/reports/7", "")
	if rec := doJSON(a, http.MethodGet, "/api/scan/reports?family=x%26y", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("an unknown family = %d; want 400 before Lens", rec.Code)
	}
	if len(got) != 6 {
		t.Fatalf("upstream calls = %q; want 6", got)
	}
	if got[4] != "GET /v1/public/scan/reports?family=oil auth= " || got[5] != "GET /v1/public/scan/reports/7 auth= " {
		t.Errorf("reports = %q, %q; want Lens's public routes with no credential", got[4], got[5])
	}
	if got[0] != "GET /v1/public/scan/track-record auth= " {
		t.Errorf("track record = %q; want Lens's public route with no credential", got[0])
	}
	for i, want := range []string{
		`/agents/agt_1/scan-watches auth=Bearer `,
		`/scan-watches auth=Bearer `,
		`/scan-watches/swt_1 auth=Bearer `,
	} {
		if !strings.Contains(got[i+1], want) || !strings.Contains(got[i+1], "/v1/workspaces/") {
			t.Errorf("call %d = %q; want the workspace's %s", i+1, got[i+1], want)
		}
	}
	if !strings.HasSuffix(got[1], `{"series":["eia.stocks.cushing-crude"],"rule":"z","z":2}`) {
		t.Errorf("watch body = %q; want only series, rule and z", got[1])
	}
}
