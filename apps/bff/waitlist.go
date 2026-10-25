package main

// waitlist.go — B44.1: talyvor.com's waitlist.
//
//	POST /api/waitlist {email, page, utm_source, utm_medium, utm_campaign, ref, website}  NO SESSION
//	     → Lens POST /v1/waitlist on LENS_PROVISION_SECRET (B44.6), one row per email
//	     ← {ok, ref_code}: the joiner's own referral code (B45.21), for the link they share
//	GET  /api/waitlist  the operator, or Bearer LENS_OPERATOR_READ_KEY → CSV of every signup
//
// The BFF has no store of its own, so the row lives in Lens. Never the IP or the user agent: the IP is
// held in memory for an hour only to refuse a sixth submit, and never leaves this process.

import (
	"bytes"
	"crypto/subtle"
	"encoding/csv"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	waitlistLimit  = 5
	waitlistWindow = time.Hour
	// testersWaitlistDomain is the nightly testers' address domain (e2e/src/waitlist.ts): left out of the CSV, counted.
	testersWaitlistDomain = "@e2e.talyvor.test"
)

// waitlistRefCode is the shape of Lens's ref codes (10 lowercase base32 characters); anything else is dropped, not refused.
var waitlistRefCode = regexp.MustCompile(`^[a-z2-7]{1,32}$`)

// waitlistHits counts submits per client IP over the last hour. shortcut: in memory, so a restart forgets
// it and two BFFs count apart; move it to Lens if the BFF ever runs more than one copy.
type waitlistHits struct {
	mu   sync.Mutex
	seen map[string][]time.Time
}

// allow records one submit from ip and says whether it is within the limit.
func (h *waitlistHits) allow(ip string, now time.Time) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.seen == nil {
		h.seen = map[string][]time.Time{}
	}
	for k, ts := range h.seen { // prune, so the map holds only the last hour
		i := 0
		for i < len(ts) && now.Sub(ts[i]) >= waitlistWindow {
			i++
		}
		if i == len(ts) {
			delete(h.seen, k)
		} else {
			h.seen[k] = ts[i:]
		}
	}
	h.seen[ip] = append(h.seen[ip], now)
	return len(h.seen[ip]) <= waitlistLimit
}

// waitlistClientIP is Caddy's X-Forwarded-For entry (the last: the one Caddy itself appended), else the peer.
func waitlistClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// normaliseWaitlistEmail is Lens's rule (cmd/lens/waitlist_handler.go), checked here first so a typo is a 400
// without a dial: trimmed, lowercased, at most 254 chars, exactly one @, a dot in the domain.
func normaliseWaitlistEmail(s string) (string, bool) {
	e := strings.ToLower(strings.TrimSpace(s))
	local, domain, found := strings.Cut(e, "@")
	if !found || len(e) > 254 || local == "" || strings.Contains(domain, "@") ||
		!strings.Contains(strings.Trim(domain, "."), ".") || strings.ContainsAny(e, " \t\r\n") {
		return "", false
	}
	return e, true
}

func (a *app) handleWaitlist(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		a.waitlistJoin(w, r)
	case http.MethodGet:
		a.waitlistExport(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (a *app) waitlistJoin(w http.ResponseWriter, r *http.Request) {
	if !a.waitlist.allow(waitlistClientIP(r), time.Now()) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many tries from here. Try again in an hour."})
		return
	}
	var in struct {
		Email       string `json:"email"`
		Page        string `json:"page"`
		UTMSource   string `json:"utm_source"`
		UTMMedium   string `json:"utm_medium"`
		UTMCampaign string `json:"utm_campaign"`
		Ref         string `json:"ref"`     // B45.21: the referrer's code from ?ref=<code>
		Website     string `json:"website"` // the honeypot: hidden from people, filled by bots
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Enter your email address."})
		return
	}
	email, ok := normaliseWaitlistEmail(in.Email)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "That doesn’t look like an email address."})
		return
	}
	if in.Website != "" {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) // a bot is told it worked and nothing is stored
		return
	}
	// UPSTREAM-BINDS-ONLY lensWaitlistBody: none
	ref := strings.ToLower(strings.TrimSpace(in.Ref))
	if !waitlistRefCode.MatchString(ref) {
		ref = ""
	}
	body, _ := json.Marshal(map[string]string{"email": email, "page": in.Page, "utm_source": in.UTMSource, "utm_medium": in.UTMMedium, "utm_campaign": in.UTMCampaign, "ref": ref})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.lensBaseURL+"/v1/waitlist", bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(provisionSecretHeader, a.cfg.provisionSecret) // server-side only, never emitted
	resp, err := a.client.Do(req)
	if err != nil {
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		log.Printf("bff: waitlist: lens answered %d", resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "We couldn’t add you just now. Try again."})
		return
	}
	var out struct {
		RefCode string `json:"ref_code"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 4<<10)).Decode(&out) // no code means no link, never a failed join
	// The same answer whether or not the email was new: a repeat gets its existing code back (Lens B45.35).
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "ref_code": out.RefCode})
}

// waitlistExport is the CSV, for an operator session or a caller holding the operator read key.
func (a *app) waitlistExport(w http.ResponseWriter, r *http.Request) {
	bearer, hasBearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if hasBearer && a.cfg.operatorReadKey != "" && subtle.ConstantTimeCompare([]byte(bearer), []byte(a.cfg.operatorReadKey)) == 1 {
		log.Printf("bff: operator-read granted key=operator-read path=%s — cross-tenant admin surface", r.URL.Path)
		a.writeWaitlistCSV(w, r)
		return
	}
	a.requireOperator(func(w http.ResponseWriter, r *http.Request, _ session) { a.writeWaitlistCSV(w, r) })(w, r)
}

func (a *app) writeWaitlistCSV(w http.ResponseWriter, r *http.Request) {
	if a.cfg.operatorReadKey == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "The waitlist is not connected: " +
			"set LENS_OPERATOR_READ_KEY in the web app's environment to the value Lens holds under the same name, and restart it."})
		return
	}
	raw, err := a.operatorRead(r.Context(), "/v1/admin/waitlist")
	var out struct {
		Signups []struct {
			Email       string  `json:"email"`
			CreatedAt   string  `json:"created_at"`
			Page        *string `json:"page"`
			UTMSource   *string `json:"utm_source"`
			UTMMedium   *string `json:"utm_medium"`
			UTMCampaign *string `json:"utm_campaign"`
			RefCode     string  `json:"ref_code"`
			Referrals   int     `json:"referrals"`
		} `json:"signups"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err != nil {
		log.Printf("bff: waitlist export: %v", err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return csvSafe(*p)
	}
	var buf bytes.Buffer
	cw := csv.NewWriter(&buf)
	_ = cw.Write([]string{"email", "created_at", "page", "utm_source", "utm_medium", "utm_campaign", "ref_code", "referrals"})
	testers := 0
	for _, s := range out.Signups {
		if strings.HasSuffix(s.Email, testersWaitlistDomain) {
			testers++
			continue
		}
		_ = cw.Write([]string{csvSafe(s.Email), s.CreatedAt, str(s.Page), str(s.UTMSource), str(s.UTMMedium), str(s.UTMCampaign), csvSafe(s.RefCode), strconv.Itoa(s.Referrals)})
	}
	_ = cw.Write([]string{"# left out: " + strconv.Itoa(testers) + " nightly tester signups (" + testersWaitlistDomain + ")"})
	cw.Flush()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="talyvor-waitlist.csv"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(buf.Bytes())
}

// csvSafe stops a spreadsheet reading a visitor's text as a formula.
func csvSafe(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}
