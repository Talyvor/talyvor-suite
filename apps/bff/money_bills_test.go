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

// B41.2 — the ticked bills go up as one request from Chat's client under the screen's Idempotency-Key; none ticked is
// refused here, since Lens reads no bills as every bill due.
func TestBillsPayReachesLensAsTicked(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = r.Method + " " + r.URL.RequestURI() + " key=" + r.Header.Get("Idempotency-Key") + " " + string(raw)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"preq_1","status":"pending_approval"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	pay := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/money/bills/pay", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "k1")
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		return rec
	}
	if rec := pay(`{"bill_ids":["bill_1","bill_2"],"client":"mcp:x"}`); rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"preq_1"`) {
		t.Fatalf("bills pay = %d %s", rec.Code, rec.Body.String())
	}
	if want := `POST /v1/money/bills/pay key=k1 {"bill_ids":["bill_1","bill_2"],"client":"chat"}`; got != want {
		t.Errorf("Lens got %q, want %q", got, want)
	}
	got = ""
	if rec := pay(`{"bill_ids":[]}`); rec.Code != http.StatusBadRequest || got != "" {
		t.Errorf("no bill ticked = %d and Lens got %q; want 400 and nothing sent", rec.Code, got)
	}
}
