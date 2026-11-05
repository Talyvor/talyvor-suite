package main

// B52.9 — sign out everywhere. POST /auth/logout-everywhere ends every sign-in of the session's person: every
// browser and phone session, and every assistant connected through Connect (their access and refresh tokens),
// in the table first and then in memory, so a failure leaves them all whole rather than half-ended, and a
// restart cannot bring any of them back.

import (
	"context"
	"log"
	"net/http"
	"time"
)

func (a *app) handleLogoutEverywhere(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if a.auth == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sign-in is off on this server, so there is nothing to sign out of"})
		return
	}
	s, ok := a.auth.sessionFrom(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required — sign in at /auth/login"})
		return
	}
	at := time.Now()
	if err := a.oauth.db.endPerson(r.Context(), s.sub, at); err != nil {
		log.Printf("bff: sign out everywhere: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "you could not be signed out everywhere; try again"})
		return
	}
	// Every token resolves through its grant (oauthGrantFrom), so the grants going ends them all.
	a.oauth.grants.deleteWhere(func(g oauthGrant) bool { return g.Who.sub == s.sub })
	a.oauth.codes.deleteWhere(func(c oauthCode) bool { return c.who.sub == s.sub })
	a.auth.endPerson(s.sub, at)
	clearCookie(w, sessionCookieName)
	log.Printf("bff: signed out everywhere (sub=%s)", s.sub)
	w.WriteHeader(http.StatusNoContent)
}

// endPerson ends every session of sub, and no seal of theirs issued until at is restored.
func (auth *authenticator) endPerson(sub string, at time.Time) {
	auth.sessions.deleteWhere(func(s session) bool { return s.sub == sub })
	if auth.sealer != nil {
		auth.sealer.endPerson(sub, at)
	}
}

// useOAuthDB is what a booting BFF reads from its database: Connect's live sign-ins, and who signed out
// everywhere, so a seal issued before that is not restored.
func (a *app) useOAuthDB(ctx context.Context, db *oauthDB) error {
	if err := db.load(ctx, a.oauth); err != nil {
		return err
	}
	cuts, err := db.signedOutEverywhere(ctx)
	if err != nil {
		return err
	}
	if a.auth != nil {
		for sub, at := range cuts {
			a.auth.endPerson(sub, at)
		}
	}
	a.oauth.db = db
	return nil
}

// deleteWhere deletes every value drop says yes to.
func (s *ttlMap[T]) deleteWhere(drop func(T) bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range s.m {
		if drop(v) {
			delete(s.m, k)
		}
	}
}
