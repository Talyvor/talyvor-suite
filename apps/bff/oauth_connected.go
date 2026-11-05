package main

// B40.8 — Settings → Connect your AI lists the assistants a person has connected (B40.6 grants) and revokes one.
//
//	GET  /api/connect/assistants              this person's connected assistants, most recently used first, each with
//	                                          its latest tool calls (B52.3)
//	POST /api/connect/assistants/{id}/revoke  end that connection: its tokens stop working at once

import (
	"cmp"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"
)

type connectedAssistant struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Scopes    []string  `json:"scopes"`
	Connected time.Time `json:"connected_at"`
	LastUsed  time.Time `json:"last_used_at"` // zero until the assistant first calls /mcp
	// Calls is B52.3's audit trail for this connection, newest first; null where the BFF keeps no database.
	Calls []assistantCall `json:"calls"`
}

// connectedCallsShown is how many of a connection's latest calls Settings lists.
const connectedCallsShown = 20

// grantsOf is the session person's live grants; a grant is the person's, whichever workspace it acts in.
func (a *app) grantsOf(r *http.Request) ([]oauthGrant, bool) {
	s, ok := a.auth.sessionFrom(r)
	if !ok {
		return nil, false
	}
	return a.oauth.grants.matching(func(g oauthGrant) bool { return g.Who.sub == s.sub }), true
}

func (a *app) handleConnectedAssistants(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	grants, _ := a.grantsOf(r)
	out := make([]connectedAssistant, 0, len(grants))
	var calls map[string][]assistantCall
	if len(grants) > 0 {
		var err error
		if calls, err = a.oauth.db.toolCallsOf(r.Context(), grants[0].Who.sub, connectedCallsShown); err != nil {
			log.Printf("bff: connected assistants: audit trail: %v", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "your assistants' activity could not be read; try again"})
			return
		}
	}
	for _, g := range grants {
		c := connectedAssistant{ID: g.ID, Name: cmp.Or(g.ClientName, "An assistant"),
			Scopes: strings.Fields(g.Scope), Connected: g.Created, LastUsed: g.LastUsed, Calls: calls[g.ID]}
		if calls != nil && c.Calls == nil {
			c.Calls = []assistantCall{} // kept, and none yet: [] rather than null
		}
		out = append(out, c)
	}
	slices.SortFunc(out, func(x, y connectedAssistant) int {
		return cmp.Or(y.LastUsed.Compare(x.LastUsed), y.Connected.Compare(x.Connected))
	})
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"assistants": out})
}

func (a *app) handleConnectedAssistantRevoke(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	grants, _ := a.grantsOf(r)
	i := slices.IndexFunc(grants, func(g oauthGrant) bool { return g.ID == r.PathValue("id") })
	if i < 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such connected assistant"})
		return
	}
	// Every token resolves through its grant (oauthGrantFrom), so deleting it ends them all.
	if err := a.revokeGrant(r.Context(), grants[i].ID); err != nil {
		log.Printf("bff: oauth revoke from Settings: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "that assistant could not be disconnected; try again"})
		return
	}
	log.Printf("bff: oauth grant revoked from Settings: client %q (sub=%s)", grants[i].ClientName, grants[i].Who.sub)
	w.WriteHeader(http.StatusNoContent)
}
