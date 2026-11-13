package main

// B28.245: the two upstream reads that buffered a whole response — the gated Lens read and the
// Track/Docs transform path — stop at maxUpstreamReadBytes. A 1 GB upstream answer is refused
// with a 502 after reading one byte past the cap, not held in memory.

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const oneGB = 1 << 30

// hugeUpstream streams prefix, oneGB bytes of padding and suffix, lazily, so the test never
// allocates the gigabyte itself; prefix+suffix make it valid JSON, so only the cap can refuse it.
// It stops as soon as the reader goes away.
func hugeUpstream(t *testing.T, prefix, suffix string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := io.WriteString(w, prefix); err != nil {
			return
		}
		chunk := []byte(strings.Repeat(" ", 64<<10))
		for sent := 0; sent < oneGB; sent += len(chunk) {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
		_, _ = io.WriteString(w, suffix)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestGatedReadCapsAOneGigabyteUpstream(t *testing.T) {
	upstream := hugeUpstream(t, `[{"id":"b1"}`, `]`)
	a := newApp(config{lensBaseURL: upstream.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/bonds", nil))

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("a 1 GB gated upstream must be refused with 502, got %d", rec.Code)
	}
	if rec.Body.Len() > 1<<10 {
		t.Fatalf("the oversized upstream body reached the browser (%d bytes)", rec.Body.Len())
	}
}

func TestProductTransformReadCapsAOneGigabyteUpstream(t *testing.T) {
	docs := &captureUpstream{srv: hugeUpstream(t, `[{"id":"pg-1","title":"`, `"}]`)}
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/spaces/sp-1/pages?limit=50", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("a 1 GB product list must be refused with 502, got %d", rec.Code)
	}
	if rec.Body.Len() > 1<<10 {
		t.Fatalf("the oversized upstream body reached the browser (%d bytes)", rec.Body.Len())
	}
}
