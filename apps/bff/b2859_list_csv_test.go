package main

import (
	"encoding/csv"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// b2859_list_csv_test.go — B28.59: every wallet list (an agent's transfers, the approvals, the schedules and the
// earnings payouts) downloads as the CSV Lens writes for it (Lens B28.332), one row per item of its JSON list.

// fakeLensLists answers each list as Lens does: its JSON list, or with ?format=csv the same items as a CSV under
// Lens's filename. got records each request Lens received.
func fakeLensLists(t *testing.T, got *[]string) *app {
	t.Helper()
	lists := map[string]struct{ key, file string }{
		"/agents/agt_1/transfers":    {"transfers", "transfers.csv"},
		"/agents/approvals":          {"approvals", "approvals.csv"},
		"/agents/schedules":          {"schedules", "schedules.csv"},
		"/v1/money/earnings-payouts": {"payouts", "earnings-payouts.csv"},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		*got = append(*got, r.URL.RequestURI())
		for suffix, l := range lists {
			if !strings.HasSuffix(r.URL.Path, suffix) {
				continue
			}
			ids := []string{l.key + "_1", l.key + "_2", l.key + "_3"}
			if r.URL.Query().Get("format") == "csv" {
				w.Header().Set("Content-Type", "text/csv; charset=utf-8")
				w.Header().Set("Content-Disposition", `attachment; filename="`+l.file+`"`)
				_, _ = io.WriteString(w, "id,memo\n"+strings.Join(ids, ",\"a, b\"\n")+",\"a, b\"\n")
				return
			}
			items := make([]map[string]string, len(ids))
			for i, id := range ids {
				items[i] = map[string]string{"id": id, "memo": "a, b"}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{l.key: items})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)
}

func TestB2859_EachWalletListsCSVHasOneRowPerItemOfItsJSONList(t *testing.T) {
	var got []string
	a := fakeLensLists(t, &got)
	for _, l := range []struct{ route, key, file string }{
		{"/api/agents/agt_1/transfers", "transfers", "transfers.csv"},
		{"/api/agents/approvals", "approvals", "approvals.csv"},
		{"/api/agents/schedules", "schedules", "schedules.csv"},
		{"/api/money/earnings-payouts", "payouts", "earnings-payouts.csv"},
	} {
		list := doJSON(a, http.MethodGet, l.route, "")
		var body map[string][]json.RawMessage
		if list.Code != http.StatusOK || json.Unmarshal(list.Body.Bytes(), &body) != nil {
			t.Fatalf("GET %s = %d %s", l.route, list.Code, list.Body.String())
		}
		got = nil
		rec := doJSON(a, http.MethodGet, l.route+"?format=csv&limit=9&workspace_id=ws_other", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s?format=csv = %d %s", l.route, rec.Code, rec.Body.String())
		}
		if len(got) != 1 || !strings.HasSuffix(got[0], "?format=csv") {
			t.Fatalf("%s: Lens got %q; want its list route with format=csv and no other key", l.route, got)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
			t.Fatalf("%s?format=csv Content-Type = %q; want Lens's CSV, not its JSON", l.route, ct)
		}
		if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, l.file) {
			t.Fatalf("%s?format=csv Content-Disposition = %q; want Lens's filename %s", l.route, cd, l.file)
		}
		rows, err := csv.NewReader(rec.Body).ReadAll()
		if err != nil {
			t.Fatalf("%s?format=csv is not a CSV: %v", l.route, err)
		}
		if len(rows)-1 != len(body[l.key]) {
			t.Fatalf("%s: the CSV has %d rows under its header; its JSON list has %d items", l.route, len(rows)-1, len(body[l.key]))
		}
	}
}
