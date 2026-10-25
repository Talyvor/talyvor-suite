package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B41.1 — an uploaded invoice reaches Lens as the bytes and media type it came as, with its source and filename, under the
// session's token.
func TestBillUploadReachesLensAsSent(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = r.Method + " " + r.URL.RequestURI() + " ct=" + r.Header.Get("Content-Type") + " auth=" + r.Header.Get("Authorization") + " " + string(raw)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"bill_1","payee_match":"new_payee"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	pdf := "%PDF-1.4 invoice"
	up := httptest.NewRequest(http.MethodPost, "/api/money/bills?source=upload&filename=acme+may.pdf&workspace=other", strings.NewReader(pdf))
	up.Header.Set("Content-Type", "application/pdf")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, up)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"bill_1"`) {
		t.Fatalf("bill upload = %d %s", rec.Code, rec.Body.String())
	}
	if want := "POST /v1/money/bills?filename=acme+may.pdf&source=upload ct=application/pdf auth=Bearer "; !strings.HasPrefix(got, want) || !strings.HasSuffix(got, " "+pdf) || strings.Contains(got, "auth=Bearer  ") {
		t.Errorf("the invoice did not go up as it came, with only source and filename, under the session's token: %q", got)
	}
}
