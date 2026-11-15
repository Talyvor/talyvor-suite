package main

import (
	"io"
	"net/http"
)

// B52.8 — ChatGPT's plugin directory proves Talyvor owns this domain by fetching /.well-known/openai-apps-challenge and
// reading back the token it issued to Talyvor's OpenAI publisher account. The token is a server setting
// (BFF_OPENAI_APPS_CHALLENGE), never committed; unset, the path is a 404 like any other unknown address.
func (a *app) handleOpenAIAppsChallenge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "GET only"})
		return
	}
	if a.cfg.openAIAppsChallenge == "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, a.cfg.openAIAppsChallenge)
}
