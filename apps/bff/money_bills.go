package main

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
)

// money_bills.go — B41.1: the bills inbox on the Pay screen — an invoice the workspace received, uploaded as a file and read
// by Lens (B41.101) into a bill matched to a saved payee or marked a new payee; on this session's own token.
//
//	GET  /api/money/bills                         the workspace's bills, due first, soonest due first
//	POST /api/money/bills?source=&filename=       the body is the invoice, its Content-Type its media type; 201 a new bill,
//	                                              200 the bill already there when this invoice was added before
//	GET  /api/money/bills/{id}                    one bill
//	POST /api/money/bills/pay {bill_ids}          B41.2: the ticked bills as one payment request (Lens B41.102), Idempotency-Key
//	                                              passed on; it is approved once with a passkey on /approve/<id> (money_requests.go)
//
// Lens reads the invoice, refuses a type it cannot read in its own words and keeps the printed bank details only to show
// and to propose a payee from: a bill is paid to a saved payee, never to the details on a document.

// billMaxBytes is Lens's own ceiling on an invoice (documents.MaxBytes).
const billMaxBytes = 25 << 20

// handleMoneyBills — GET /api/money/bills lists them; POST adds one invoice.
func (a *app) handleMoneyBills(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/bills", nil)
	case http.MethodPost:
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "send the invoice with its own Content-Type: a PDF, Word, HTML or text document"})
			return
		}
		doc, err := io.ReadAll(http.MaxBytesReader(w, r.Body, billMaxBytes))
		if err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "an invoice can be at most 25 MB"})
			return
		}
		if len(doc) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the invoice is empty"})
			return
		}
		q := url.Values{}
		if s := r.URL.Query().Get("source"); s != "" {
			q.Set("source", s)
		}
		if f := r.URL.Query().Get("filename"); f != "" {
			q.Set("filename", f)
		}
		path := "/v1/money/bills"
		if len(q) > 0 {
			path += "?" + q.Encode()
		}
		a.lensRelayTyped(w, r, t.token, http.MethodPost, path, doc, mediaType, "bills upload")
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyBill — GET /api/money/bills/{id}: one bill.
func (a *app) handleMoneyBill(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "bill id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/bills/"+url.PathEscape(id), nil)
}

// handleMoneyBillsPay — POST /api/money/bills/pay {bill_ids}: prepares paying those bills as one request; nothing is paid here.
func (a *app) handleMoneyBillsPay(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		BillIDs []string `json:"bill_ids"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || len(in.BillIDs) == 0 {
		// Never empty: Lens reads no bills as "every bill due", and the screen pays only what is ticked.
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tick at least one bill to pay"})
		return
	}
	// shortcut: Lens names a request's client "chat", "voice", "mcp:" or "key:" only, so the Pay screen's reads as Chat's; add a "web" client in Lens to tell them apart.
	// UPSTREAM-BINDS-ONLY lensBillsPayBody: none
	body, _ := json.Marshal(map[string]any{"client": "chat", "bill_ids": in.BillIDs})
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/bills/pay", body)
}
