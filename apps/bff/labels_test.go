package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// lensLabels is talyvor-lens B56.7's GET /v1/public/labels as production answers it: every money capability Sandbox.
const lensLabels = `{"labels":{"spend_on_talyvor":"sandbox","agent_cards":"sandbox"},"card_payments":"test","updated_at":"2026-11-10T02:00:00Z"}`

// B56.9 — /api/pricing carries Lens's labels for StatusLabel, and the gates' built and the fees' charged (talyvor-lens
// B56.8) as Lens states them. A label Lens gave that StatusLabel cannot draw is left out, and the reply may be kept a
// minute at most.
func TestPricing_ServesLensLabelsBuiltAndCharged(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/public/labels":
			_, _ = io.WriteString(w, `{"labels":{"spend_on_talyvor":"live","agent_cards":"sandbox","odd":"maybe"},"card_payments":"live"}`)
		case "/v1/public/plan-gates":
			_, _ = io.WriteString(w, strings.TrimSuffix(lensPlanGates, "}")+`,"built":{"audit_export":true,"sso":false}}`)
		case "/v1/public/fees":
			_, _ = io.WriteString(w, strings.TrimSuffix(lensFees, "}")+`,"charged":{"market_take_bps":true,"fx_margin_bps":false}}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(up.Close)
	a, _, _ := pricingApp(t, http.StatusOK)
	a.cfg.lensBaseURL = up.URL

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pricing", nil))
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=60" {
		t.Errorf("Cache-Control = %q, want public, max-age=60: a label may run behind Lens by a minute and no more", cc)
	}
	var out struct {
		Labels    map[string]string `json:"labels"`
		PlanGates struct {
			Built map[string]bool `json:"built"`
		} `json:"plan_gates"`
		Fees struct {
			Charged map[string]bool `json:"charged"`
		} `json:"fees"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (body %s)", err, rec.Body.String())
	}
	if len(out.Labels) != 2 || out.Labels["spend_on_talyvor"] != "live" || out.Labels["agent_cards"] != "sandbox" {
		t.Errorf("labels = %v, want spend_on_talyvor live and agent_cards sandbox, and odd left out", out.Labels)
	}
	if len(out.PlanGates.Built) != 2 || !out.PlanGates.Built["audit_export"] || out.PlanGates.Built["sso"] {
		t.Errorf("plan_gates.built = %v, want audit_export true and sso false as Lens stated them", out.PlanGates.Built)
	}
	if len(out.Fees.Charged) != 2 || !out.Fees.Charged["market_take_bps"] || out.Fees.Charged["fx_margin_bps"] {
		t.Errorf("fees.charged = %v, want market_take_bps true and fx_margin_bps false as Lens stated them", out.Fees.Charged)
	}
}

// B56.9 — a Lens that states gates and fees without built or charged has them left out, never read as false.
func TestPricing_OmitsBuiltAndChargedLensDoesNotState(t *testing.T) {
	a, _, _ := pricingApp(t, http.StatusOK)
	out := getPricing(t, a)
	if _, ok := out["plan_gates"].(map[string]any)["built"]; ok {
		t.Errorf("plan_gates.built = %v from a Lens that did not state it — want it omitted", out["plan_gates"])
	}
	if _, ok := out["fees"].(map[string]any)["charged"]; ok {
		t.Errorf("fees.charged = %v from a Lens that did not state it — want it omitted", out["fees"])
	}
}

// B56.9 — a label is reused for a minute, then asked of Lens again.
func TestPricing_AsksLensForTheLabelsAgainAfterAMinute(t *testing.T) {
	a, _, hits := pricingApp(t, http.StatusOK)
	getPricing(t, a)
	getPricing(t, a)
	if hits["/v1/public/labels"] != 1 {
		t.Fatalf("two reads inside a minute asked Lens %d times, want once", hits["/v1/public/labels"])
	}
	a.public.labels.at = time.Now().Add(-publicLabelTTL - time.Second)
	a.public.gates.at = time.Now().Add(-publicLabelTTL - time.Second)
	a.public.fees.at = time.Now().Add(-publicLabelTTL - time.Second)
	getPricing(t, a)
	for _, path := range []string{"/v1/public/labels", "/v1/public/plan-gates", "/v1/public/fees"} {
		if hits[path] != 2 {
			t.Errorf("a read after a minute asked Lens's %s %d times in all, want twice", path, hits[path])
		}
	}
}

// B56.9 — /api/wallets/capabilities passes each capability's label through as Lens gives it for the caller's workspace.
func TestWalletCapabilitiesPassTheLabelThrough(t *testing.T) {
	const caps = `{"capabilities":[{"capability":"agent_cards","class":"RED","real_money":false,"label":"sandbox"},` +
		`{"capability":"spend_on_talyvor","class":"GREEN","real_money":true,"label":"live"}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case provisionPath:
			serveFakeProvision(w, r)
		case "/v1/wallets/capabilities":
			_, _ = io.WriteString(w, caps)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{
		addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret,
		webDist: t.TempDir(), authMode: authModeDisabled,
	}, nil)
	rec := doJSON(a, http.MethodGet, "/api/wallets/capabilities", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/wallets/capabilities = %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Capabilities []struct {
			Key   string `json:"capability"`
			Label string `json:"label"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (body %s)", err, rec.Body.String())
	}
	if len(out.Capabilities) != 2 || out.Capabilities[0].Label != "sandbox" || out.Capabilities[1].Label != "live" {
		t.Errorf("capabilities = %+v, want agent_cards sandbox and spend_on_talyvor live as Lens gave them", out.Capabilities)
	}
}
