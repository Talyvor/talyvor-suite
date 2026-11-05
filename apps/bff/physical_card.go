package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// physical_card.go — B53.12: the owner's physical Talyvor Card, on this session's own token (Lens B53.19).
//
//	GET  /api/money/physical-cards                 the owner's physical cards, each with its delivery status
//	POST /api/money/physical-cards                 {name_on_card, address} — order one in the partner's standard design
//	POST /api/money/physical-cards/{id}/activate   {last4} — on arrival
//	POST /api/money/physical-cards/{id}/replace    {reason} — lost, stolen or damaged: the old card frozen at once
//
// Lens holds the switch: while LENS_PHYSICAL_CARDS is off every route answers 404 and the web app shows nothing. Lens
// checks the address and decides every state change; the PIN is set and shown only in the partner's own screens.

// cardAddress is where the card is posted, as the owner typed it; Lens checks it.
type cardAddress struct {
	Line1    string `json:"line1"`
	Line2    string `json:"line2"`
	City     string `json:"city"`
	Postcode string `json:"postcode"`
	Country  string `json:"country"`
}

func (a *app) handlePhysicalCards(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.lensRelay(w, r, t.token, http.MethodGet, "/v1/money/physical-cards", nil, "physical cards")
	case http.MethodPost:
		var in struct {
			NameOnCard string      `json:"name_on_card"`
			Address    cardAddress `json:"address"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPhysicalCardOrderBody: none
		body, _ := json.Marshal(in)
		a.lensRelay(w, r, t.token, http.MethodPost, "/v1/money/physical-cards", body, "physical card order")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

func (a *app) handlePhysicalCardActivate(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "card id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Last4 string `json:"last4"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensPhysicalCardActivateBody: none
	body, _ := json.Marshal(in)
	a.lensRelay(w, r, t.token, http.MethodPost, "/v1/money/physical-cards/"+url.PathEscape(id)+"/activate", body, "physical card activate")
}

func (a *app) handlePhysicalCardReplace(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "card id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensPhysicalCardReplaceBody: none
	body, _ := json.Marshal(in)
	a.lensRelay(w, r, t.token, http.MethodPost, "/v1/money/physical-cards/"+url.PathEscape(id)+"/replace", body, "physical card replace")
}
