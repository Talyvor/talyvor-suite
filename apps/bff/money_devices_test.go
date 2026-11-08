package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B40.31 — the phone registers its device key through the BFF, sees it listed, sets its push token and revokes it, each
// against a fake Lens holding one key under the session's token; a registration Lens refuses comes back in Lens's words.
func TestPhoneDeviceKeyRegistersListsAndRevokesThroughBFF(t *testing.T) {
	var mu sync.Mutex
	var device map[string]any
	bodies := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		raw, _ := io.ReadAll(r.Body)
		bodies[r.Method+" "+r.URL.Path] = string(raw)
		w.Header().Set("Content-Type", "application/json")
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/money/devices/challenge":
			_, _ = w.Write([]byte(`{"challenge":"ch_1"}`))
		case "POST /v1/money/devices":
			var in map[string]string
			_ = json.Unmarshal(raw, &in)
			if in["attestation"] == "" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"the attestation does not bind this key to the challenge"}`))
				return
			}
			device = map[string]any{"id": "dk_1", "platform": in["platform"], "name": in["name"], "revoked": false}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(device)
		case "GET /v1/money/devices":
			_ = json.NewEncoder(w).Encode(map[string]any{"devices": []any{device}})
		case "POST /v1/money/devices/dk_1/push-token":
			_ = json.NewEncoder(w).Encode(device)
		case "POST /v1/money/devices/dk_1/revoke":
			device["revoked"] = true
			_ = json.NewEncoder(w).Encode(device)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/devices/challenge", ``); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ch_1"`) {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body.String())
	}
	reg := `{"platform":"ios","name":"Work iPhone","public_key":"pk","challenge":"ch_1","signature":"sig","attestation":"att","by":"x"}`
	if rec := doJSON(a, http.MethodPost, "/api/money/devices", strings.Replace(reg, `"att"`, `""`, 1)); rec.Code != http.StatusBadRequest ||
		!strings.Contains(rec.Body.String(), "the attestation does not bind this key to the challenge") {
		t.Fatalf("a registration Lens refuses = %d %s, want 400 in Lens's words", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/devices", reg); rec.Code != http.StatusCreated {
		t.Fatalf("register = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/devices", ``); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"id":"dk_1"`) {
		t.Fatalf("list = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/devices/dk_1/push-token", `{"push_token":""}`); rec.Code != http.StatusOK {
		t.Fatalf("push token = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/devices/dk_1/revoke", ``); rec.Code != http.StatusOK {
		t.Fatalf("revoke = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/devices", ``); !strings.Contains(rec.Body.String(), `"revoked":true`) {
		t.Fatalf("after revoke the list = %s, want the key revoked", rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if got := bodies["POST /v1/money/devices"]; got != `{"platform":"ios","name":"Work iPhone","public_key":"pk","challenge":"ch_1","signature":"sig","attestation":"att"}` {
		t.Errorf("registration reached Lens as %s, want the six fields as sent and nothing else", got)
	}
	if got := bodies["POST /v1/money/devices/dk_1/push-token"]; got != `{"push_token":""}` {
		t.Errorf("an emptied push token reached Lens as %s, want it kept as \"\" (which removes it)", got)
	}
}

// B50.22 — once a workspace has a key, a new passkey or device key registers only signed by one it has (Lens B50.20):
// the BFF forwards that "assertion" to Lens on both registration routes, a passkey's or a device key's alike.
func TestKeyEnrolAssertionReachesLensOnBothRegistrationRoutes(t *testing.T) {
	var mu sync.Mutex
	got := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got[r.URL.Path] = string(raw)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"k_1"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	for _, c := range []struct{ path, body, lens, assertion string }{
		{"/api/agents/passkeys", `{"credential_id":"bmV3","name":"Laptop","public_key":"pk","client_data_json":"cd","authenticator_data":"ad",`,
			"/agents/passkeys", `{"credential_id":"b2xk","client_data_json":"Y2Q","authenticator_data":"YWQ","signature":"c2ln"}`},
		{"/api/money/devices", `{"platform":"ios","name":"Work iPhone","public_key":"pk","challenge":"ch_1","signature":"sig","attestation":"att",`,
			"/v1/money/devices", `{"device_id":"dev_9","challenge":"ch_1","signature":"c2lnLTE"}`},
	} {
		if rec := doJSON(a, http.MethodPost, c.path, c.body+`"assertion":`+c.assertion+`}`); rec.Code != http.StatusCreated {
			t.Fatalf("%s = %d %s", c.path, rec.Code, rec.Body.String())
		}
		mu.Lock()
		var body string
		for p, b := range got {
			if strings.HasSuffix(p, c.lens) {
				body = b
			}
		}
		mu.Unlock()
		var sent struct {
			Assertion map[string]string `json:"assertion"`
		}
		var want map[string]string
		_ = json.Unmarshal([]byte(body), &sent)
		_ = json.Unmarshal([]byte(c.assertion), &want)
		for k, v := range want {
			if sent.Assertion[k] != v {
				t.Errorf("%s: Lens got %q, its assertion's %s is not %q", c.path, body, k, v)
			}
		}
	}
}

// B55.3 — a key waiting to be let in from another device (Lens B55.1): each enrolment route reaches Lens's under the
// session's workspace, and approve carries the assertion and nothing else; approve with no assertion never reaches Lens.
func TestKeyEnrolmentRoutesRelayToLens(t *testing.T) {
	var mu sync.Mutex
	got := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got[r.Method+" "+r.URL.Path] = string(raw)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"enr_1","status":"waiting"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	assertion := `{"credential_id":"Y3JlZA","client_data_json":"Y2Q","authenticator_data":"YWQ","signature":"c2ln"}`
	for _, c := range []struct{ method, path, body, lens, sent string }{
		{http.MethodGet, "/api/agents/keys/enrolments", "", "GET /agents/keys/enrolments", ""},
		{http.MethodGet, "/api/agents/keys/enrolments/enr_1", "", "GET /agents/keys/enrolments/enr_1", ""},
		{http.MethodPost, "/api/agents/keys/enrolments/enr_1/challenge", `{}`, "POST /agents/keys/enrolments/enr_1/challenge", ""},
		{http.MethodPost, "/api/agents/keys/enrolments/enr_1/approve", `{"assertion":` + assertion + `,"extra":"x"}`, "POST /agents/keys/enrolments/enr_1/approve", `{"assertion":` + assertion + `}`},
		{http.MethodPost, "/api/agents/keys/enrolments/enr_1/decline", `{}`, "POST /agents/keys/enrolments/enr_1/decline", ""},
	} {
		if rec := doJSON(a, c.method, c.path, c.body); rec.Code != http.StatusOK {
			t.Fatalf("%s %s = %d %s", c.method, c.path, rec.Code, rec.Body.String())
		}
		mu.Lock()
		body, found := "", false
		for p, b := range got {
			if strings.HasPrefix(c.lens, strings.Fields(p)[0]+" ") && strings.HasSuffix(p, strings.Fields(c.lens)[1]) {
				body, found = b, true
			}
		}
		mu.Unlock()
		if !found {
			t.Fatalf("%s %s never reached Lens's %s; Lens saw %v", c.method, c.path, c.lens, got)
		}
		if body != c.sent {
			t.Errorf("%s %s sent Lens %q, want %q", c.method, c.path, body, c.sent)
		}
	}

	mu.Lock()
	clear(got)
	mu.Unlock()
	if rec := doJSON(a, http.MethodPost, "/api/agents/keys/enrolments/enr_1/approve", `{}`); rec.Code != http.StatusBadRequest {
		t.Errorf("approve with no assertion = %d, want 400", rec.Code)
	}
	mu.Lock()
	defer mu.Unlock()
	for p := range got {
		if p != "POST "+provisionPath {
			t.Errorf("approve with no assertion reached Lens at %s", p)
		}
	}
}
