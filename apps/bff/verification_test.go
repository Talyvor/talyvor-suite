package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
)

// B30.116 — each verification check reaches Lens under the session's workspace with only the fields its own check
// confirms, the record comes back as Lens answers it, and Lens's refusal of a check out of order comes back with its
// sentence.
func TestVerificationChecksReachLensWithOnlyTheirOwnFields(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/verification"):
			_, _ = w.Write([]byte(`{"level":"L1","live_level":"L0","checks":[{"level":"L1","test":true,"evidence_ref":"kyc_1"}]}`))
		case strings.HasSuffix(r.URL.Path, "/verification/company"):
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"economy: verification levels are reached in order: the company checked check (L3) needs L2"}`))
		default:
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"check":{"level":"L1"},"verification":{"level":"L1"}}`))
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/verification/contact", `{"email":"o@example.com","phone":"+447700900123","name":"Smuggled"}`); rec.Code != http.StatusCreated {
		t.Fatalf("contact = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/verification/identity", `{"name":"Ada Owner","country":"GB","date_of_birth":"1990-04-01","address":{"lines":["12 Marlborough Road"],"town":"Twickenham","postcode":"TW1 3AA","country":"GB","flat":"x"},"phone":"+1"}`); rec.Code != http.StatusCreated {
		t.Fatalf("identity = %d %s", rec.Code, rec.Body.String())
	}
	rec := doJSON(a, http.MethodPost, "/api/verification/company", `{"name":"Owner Ltd","country":"GB","company_number":"01234567","directors":["Ada Owner"],"people_with_significant_control":["Ada Owner"]}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "needs L2") {
		t.Fatalf("company out of order = %d %s, want Lens's 409 and its sentence", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/verification", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"evidence_ref":"kyc_1"`) {
		t.Fatalf("record = %d %s", rec.Code, rec.Body.String())
	}

	if len(got) != 4 {
		t.Fatalf("Lens received %d requests, want 4: %q", len(got), got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(got[0])[1], "/v1/workspaces/"), "/")[0]
	want := []struct {
		line string
		keys []string
	}{
		{"POST /v1/workspaces/" + ws + "/verification/contact ", []string{"email", "phone"}},
		{"POST /v1/workspaces/" + ws + "/verification/identity ", []string{"address", "country", "date_of_birth", "name"}},
		{"POST /v1/workspaces/" + ws + "/verification/company ", []string{"company_number", "country", "directors", "name", "people_with_significant_control"}},
		{"GET /v1/workspaces/" + ws + "/verification ", nil},
	}
	for i, w := range want {
		if !strings.HasPrefix(got[i], w.line) {
			t.Fatalf("Lens's request %d was %q, want it to begin %q", i+1, got[i], w.line)
		}
		if w.keys == nil {
			continue
		}
		var sent map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(got[i], w.line)), &sent); err != nil {
			t.Fatalf("request %d's body is not JSON: %q", i+1, got[i])
		}
		keys := []string{}
		for k := range sent {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if strings.Join(keys, " ") != strings.Join(w.keys, " ") {
			t.Fatalf("request %d sent %v, want exactly the keys %v", i+1, sent, w.keys)
		}
	}
	// B61.46 — the identity check carries the home address whole, and only its own four parts.
	if want := `"address":{"lines":["12 Marlborough Road"],"town":"Twickenham","postcode":"TW1 3AA","country":"GB"}`; !strings.Contains(got[1], want) {
		t.Fatalf("the identity check reached Lens as %q, want it to carry %s", got[1], want)
	}
}

// B61.46 — an identity check without a home address reaches Lens without one: Lens takes it as optional.
func TestVerificationIdentityWithoutAnAddressSendsNone(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = string(raw)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"check":{"level":"L2"},"verification":{"level":"L2"}}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)
	if rec := doJSON(a, http.MethodPost, "/api/verification/identity", `{"name":"Ada Owner","country":"GB","date_of_birth":"1990-04-01"}`); rec.Code != http.StatusCreated {
		t.Fatalf("identity = %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(got, "address") {
		t.Fatalf("an identity check without a home address reached Lens as %s, want no address key", got)
	}
}

// B65.2, B65.4 — the page the identity partner sends the person back to reaches Lens by its name, signup, settings or
// phone, on the GET's query and the identity check's body; an address, or any other name, never reaches Lens.
func TestVerificationReturnReachesLensOnlyByItsName(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.RequestURI()+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"level":"L1","checks":[]}`))
			return
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"check":{"level":"L2"},"verification":{"level":"L1"}}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	for _, path := range []string{"/api/verification?return_to=signup", "/api/verification?return_to=https%3A%2F%2Fevil.example", "/api/verification", "/api/verification?return_to=phone"} {
		if rec := doJSON(a, http.MethodGet, path, ""); rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d %s", path, rec.Code, rec.Body.String())
		}
	}
	for _, to := range []string{"signup", "https://evil.example/back", "phone"} {
		body := `{"name":"Ada Owner","country":"GB","date_of_birth":"1990-04-01","return_to":"` + to + `"}`
		if rec := doJSON(a, http.MethodPost, "/api/verification/identity", body); rec.Code != http.StatusCreated {
			t.Fatalf("identity with return_to %q = %d %s", to, rec.Code, rec.Body.String())
		}
	}
	if len(got) != 7 {
		t.Fatalf("Lens received %d requests, want 7: %q", len(got), got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(got[0])[1], "/v1/workspaces/"), "/")[0]
	base := "/v1/workspaces/" + ws + "/verification"
	for i, want := range []string{"GET " + base + "?return_to=signup ", "GET " + base + " ", "GET " + base + " ", "GET " + base + "?return_to=phone "} {
		if got[i] != want {
			t.Fatalf("Lens's request %d was %q, want %q", i+1, got[i], want)
		}
	}
	if !strings.Contains(got[4], `"return_to":"signup"`) {
		t.Fatalf("the identity check reached Lens as %q, want return_to signup", got[4])
	}
	if strings.Contains(got[5], "return_to") || strings.Contains(got[5], "evil") {
		t.Fatalf("an address as return_to reached Lens as %q, want no return_to", got[5])
	}
	if !strings.Contains(got[6], `"return_to":"phone"`) {
		t.Fatalf("the phone's identity check reached Lens as %q, want return_to phone", got[6])
	}
}
