package main

// b6193_people_finding_test.go — B61.93: Settings, Privacy reads and changes how the session's own person is found,
// through the real BFF over TLS; findingLens answers Lens B61.32's two finding routes as cmd/lens answers them and
// hands everything else to the door suite's Lens.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"testing"
)

type findingLens struct {
	mu     sync.Mutex
	bodies []map[string]any // what each finding call carried, in order
	refuse map[string]any   // the next change's refusal: status and error, as writeJSONErr words it
}

func startFindingSuite(t *testing.T) (*doorSuite, *findingLens) {
	t.Helper()
	s := startDoorSuite(t, nil)
	f := &findingLens{}
	target, _ := url.Parse(s.door.srv.URL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/people/finding") {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Header.Get(provisionSecretHeader) != testProvisionSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.bodies = append(f.bodies, in)
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/people/finding/change" && f.refuse != nil {
			w.WriteHeader(int(f.refuse["status"].(float64)))
			_ = json.NewEncoder(w).Encode(map[string]any{"error": f.refuse["error"]})
			f.refuse = nil
			return
		}
		name, _ := in["name"].(string)
		byPhone, _ := in["by_phone"].(bool)
		_ = json.NewEncoder(w).Encode(map[string]any{"name": name, "email": "", "phone": "+447700900031",
			"by_name": false, "by_phone": byPhone, "by_email": false, "receive_account_id": "acc_1"})
	}))
	t.Cleanup(srv.Close)
	s.app.cfg.lensBaseURL = srv.URL
	return s, f
}

func (f *findingLens) last(t *testing.T) map[string]any {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.bodies) == 0 {
		t.Fatal("Lens's finding routes were never called")
	}
	return f.bodies[len(f.bodies)-1]
}

func TestB6193_FindingIsTheSessionsOwnPerson(t *testing.T) {
	s, f := startFindingSuite(t)
	br := s.browser()
	s.join(br, "+447700900031", "418263")
	person := s.door.people["+447700900031"].id

	st, out := s.get(br, "", peopleFindingPath)
	if st != http.StatusOK || out["phone"] != "+447700900031" || out["by_phone"] != false {
		t.Fatalf("read: %d %v", st, out)
	}
	if _, leaked := out["receive_account_id"]; leaked {
		t.Fatalf("the read relays more than Settings shows: %v", out)
	}
	if got := f.last(t)["person_id"]; got != person {
		t.Fatalf("Lens was asked for person %v, want the session's %s", got, person)
	}

	// A person_id from the browser is never read: the change is the session's person's.
	st, out, _ = s.post(br, "", peopleFindingPath, map[string]any{"person_id": "per_someone_else", "name": "maya.l", "by_phone": true})
	if st != http.StatusOK || out["name"] != "maya.l" || out["by_phone"] != true {
		t.Fatalf("change: %d %v", st, out)
	}
	sent := f.last(t)
	if sent["person_id"] != person || sent["name"] != "maya.l" || sent["by_phone"] != true {
		t.Fatalf("Lens was sent %v, want the session's person %s with the name and the switch", sent, person)
	}
	if _, ok := sent["by_name"]; ok {
		t.Fatalf("a switch not pressed was sent: %v", sent)
	}
}

func TestB6193_LensRefusalWordsReachThePerson(t *testing.T) {
	s, f := startFindingSuite(t)
	br := s.browser()
	s.join(br, "+447700900032", "418263")
	for _, c := range []struct {
		status int
		words  string
	}{
		{http.StatusConflict, "That Talyvor name is taken: choose another"},
		{http.StatusBadRequest, "Invalid Talyvor name: that name is kept for Talyvor"},
	} {
		f.mu.Lock()
		f.refuse = map[string]any{"status": float64(c.status), "error": c.words}
		f.mu.Unlock()
		st, out, _ := s.post(br, "", peopleFindingPath, map[string]any{"name": "grace.h"})
		if st != c.status || out["error"] != c.words {
			t.Fatalf("refused name: %d %v, want %d with Lens's words %q", st, out, c.status, c.words)
		}
	}
}

func TestB6193_CrossSiteChangeIsRefused(t *testing.T) {
	s, f := startFindingSuite(t)
	br := s.browser()
	s.join(br, "+447700900033", "418263")
	req, _ := http.NewRequest(http.MethodPost, s.ts.URL+peopleFindingPath, bytes.NewReader([]byte(`{"by_phone":true}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	resp, err := br.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("a cross-site change: %d, want 403", resp.StatusCode)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.bodies) != 0 {
		t.Fatalf("a cross-site change reached Lens: %v", f.bodies)
	}
}
