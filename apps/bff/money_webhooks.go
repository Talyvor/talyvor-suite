package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// money_webhooks.go — B28.74: signed webhooks for wallet events, on this session's own token (Lens B28.344).
//
//	GET    /api/money/event-webhooks             the endpoints, oldest first, without their secrets, and every event type
//	POST   /api/money/event-webhooks             {url, events} — an https endpoint taking those events (none: every one);
//	                                             its signing secret comes back this once
//	POST   /api/money/event-webhooks/{id}/rotate a new signing secret, shown this once; the old one signs beside it for a day
//	DELETE /api/money/event-webhooks/{id}        remove one
//	GET    /api/money/event-webhooks/events      each event queued, delivered or failed to each endpoint, newest first
//
// Lens decides who may (the owner or an admin), what an endpoint may be (https, on the public internet) and signs every
// event; nothing here sees a secret except to pass the one answer through.

func (a *app) handleMoneyEventWebhooks(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/event-webhooks", nil, "wallet webhooks")
	case http.MethodPost:
		var in struct {
			URL    string   `json:"url"`
			Events []string `json:"events"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensWalletWebhookBody: none
		body, _ := json.Marshal(in)
		a.lensRelay(w, r, t.token, http.MethodPost, "/v1/money/event-webhooks", body, "wallet webhooks")
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (a *app) handleMoneyEventWebhook(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	id, ok := pathID(w, "webhook id", r.PathValue("id"))
	if !ok {
		return
	}
	a.lensRelay(w, r, t.token, http.MethodDelete, "/v1/money/event-webhooks/"+url.PathEscape(id), nil, "wallet webhook")
}

func (a *app) handleMoneyEventWebhookRotate(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "webhook id", r.PathValue("id"))
	if !ok {
		return
	}
	a.lensRelay(w, r, t.token, http.MethodPost, "/v1/money/event-webhooks/"+url.PathEscape(id)+"/rotate", nil, "wallet webhook")
}

func (a *app) handleMoneyEventWebhookEvents(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/event-webhooks/events", nil, "wallet webhook events")
}
