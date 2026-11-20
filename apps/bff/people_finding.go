package main

import "net/http"

// people_finding.go — B61.93: Settings, Privacy and the end of sign-up. How the session's own person is found on
// Talyvor, to be paid (Lens B61.32, on the provision secret):
//
//	GET  /api/people/finding   {name, email, phone, by_name, by_phone, by_email} — their Talyvor name and the three
//	                           switches, each off until the person turns it on
//	POST /api/people/finding   {name?, by_name?, by_phone?, by_email?} — changes what is given and answers the
//	                           settings as they are now; a name refused, taken or kept for Talyvor comes back in
//	                           Lens's words
//
// The person is always the session's: a person_id the browser sends is never read, and a session with no person yet
// (a Google sign-in that has not moved) is told to confirm a phone number first. Lens decides what a name may be and
// whether a switch may turn on.

const peopleFindingPath = "/api/people/finding"

// handlePeopleFinding — GET reads the session's person's settings, POST changes them.
func (a *app) handlePeopleFinding(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		methodNotAllowed(w, "GET, POST")
		return
	}
	if a.cfg.authMode == authModeDisabled || a.auth == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sign-in is off on this server"})
		return
	}
	if a.cfg.provisionSecret == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "sign-in is not set up on this server yet"})
		return
	}
	_, s, ok := a.personSession(w, r)
	if !ok {
		return
	}
	body := map[string]any{"person_id": s.personID}
	path := "/v1/people/finding"
	if r.Method == http.MethodPost {
		// Only what Settings changes; the email Lens finds by is the one the BFF confirmed, never typed here.
		var in struct {
			Name    *string `json:"name"`
			ByName  *bool   `json:"by_name"`
			ByPhone *bool   `json:"by_phone"`
			ByEmail *bool   `json:"by_email"`
		}
		if !a.decodeDoor(w, r, &in) {
			return
		}
		if in.Name != nil {
			body["name"] = *in.Name
		}
		if in.ByName != nil {
			body["by_name"] = *in.ByName
		}
		if in.ByPhone != nil {
			body["by_phone"] = *in.ByPhone
		}
		if in.ByEmail != nil {
			body["by_email"] = *in.ByEmail
		}
		path += "/change"
	}
	var out struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Phone   string `json:"phone"`
		ByName  bool   `json:"by_name"`
		ByPhone bool   `json:"by_phone"`
		ByEmail bool   `json:"by_email"`
	}
	if err := a.lensDoor(r.Context(), path, body, &out); err != nil {
		writeDoorFailure(w, "people finding", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

// findingWordsPath is a Lens finding route: it words a refused name or switch with no reason (B61.32's 400 and 409),
// and those words are the person's to read.
func findingWordsPath(path string) bool {
	return path == "/v1/people/finding" || path == "/v1/people/finding/change"
}
