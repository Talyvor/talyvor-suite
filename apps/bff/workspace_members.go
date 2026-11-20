package main

// workspace_members.go — B52.36: Settings → Members invites a person into the workspace, and the person accepts.
// Lens (B52.35) keeps the invite links and the members; the BFF only relays, on the session's own token for the owner's
// routes and on the provision secret for the accept:
//
//	GET    /api/workspace/member-invites        {"invites": [...]} — the workspace's invite links, never a token
//	POST   /api/workspace/member-invites        {"max_uses", "expires_at"} → the new link, its token said this once
//	DELETE /api/workspace/member-invites/{id}   revoke one link
//	GET    /api/workspace/members               {"members": [{id, role, added_at}]} — who joined by invite
//	DELETE /api/workspace/members/{id}          remove one of them
//	POST   /api/invites/accept                  {"token"} → {"workspace_id", "name", "created"}
//
// THE ACCEPT IS THE SESSION'S. The identity Lens adds is the one the session was signed in as (accountsCaller); the
// browser sends the token and nothing else is read from its body, so no one can join a workspace as someone else.
// A member's identity is the sign-in's issuer and subject: it is never sent to the browser.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	memberInvitesPath   = "/member-invites"
	workspaceMembersAPI = "/members"
)

// handleMemberInvites — GET lists the workspace's invite links, POST makes one.
func (a *app) handleMemberInvites(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, memberInvitesPath, nil)
	case http.MethodPost:
		var in struct {
			MaxUses   int        `json:"max_uses"`
			ExpiresAt *time.Time `json:"expires_at"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensMemberInviteBody: none
		body, _ := json.Marshal(map[string]any{"max_uses": in.MaxUses, "expires_at": in.ExpiresAt})
		a.agentBankRelay(w, r, t, http.MethodPost, memberInvitesPath, body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleMemberInvite — DELETE revokes one invite link.
func (a *app) handleMemberInvite(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodDelete, memberInvitesPath+"/"+url.PathEscape(r.PathValue("id")), nil)
}

// workspaceMember is one of Lens's members as the screen shows it: no identity.
type workspaceMember struct {
	ID      string `json:"id"`
	Role    string `json:"role"`
	AddedAt string `json:"added_at"`
}

// handleWorkspaceMembers — GET lists who joined by invite, without their identities.
func (a *app) handleWorkspaceMembers(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.cfg.lensBaseURL+lensWorkspacePath(t, workspaceMembersAPI), nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: workspace members: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		var refusal struct {
			Error string `json:"error"`
		}
		if resp.StatusCode < 400 || resp.StatusCode >= 500 || json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
			return
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
		return
	}
	var got struct {
		Members []workspaceMember `json:"members"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
		return
	}
	if got.Members == nil {
		got.Members = []workspaceMember{}
	}
	writeJSON(w, http.StatusOK, got)
}

// handleWorkspaceMember — DELETE removes one member.
func (a *app) handleWorkspaceMember(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodDelete, workspaceMembersAPI+"/"+url.PathEscape(r.PathValue("id")), nil)
}

// handleInviteAccept — POST {"token"}: the session's person joins the invite's workspace.
func (a *app) handleInviteAccept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if a.cfg.provisionSecret == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "sign-in is not set up on this server yet"})
		return
	}
	c, ok := a.accountsCaller(w, r)
	if !ok {
		return
	}
	var in struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil || strings.TrimSpace(in.Token) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `send {"token": "…"}`})
		return
	}
	if c.s.synthetic {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "a test session holds one account"})
		return
	}
	var joined struct {
		Member struct {
			WorkspaceID string `json:"workspace_id"`
		} `json:"member"`
		Created bool `json:"created"`
	}
	// UPSTREAM-BINDS-ONLY lensInviteAcceptBody: none
	status, raw, err := a.provisionSecretPost(r.Context(), "/v1/provision/invites/accept", map[string]string{"identity": c.identity, "token": strings.TrimSpace(in.Token)})
	if err == nil && status == http.StatusOK {
		err = json.Unmarshal(raw, &joined)
	}
	switch {
	case err != nil:
		log.Printf("bff: accepting an invite: %s", redactSecret(err.Error()))
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "That did not work just now. Try again."})
		return
	case status == http.StatusNotFound:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "This invite link has expired, been used or been revoked. Ask for a new one."})
		return
	case status == http.StatusConflict:
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This invite is to your own workspace."})
		return
	case status != http.StatusOK || joined.Member.WorkspaceID == "":
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "That did not work just now. Try again."})
		return
	}
	out := map[string]any{"workspace_id": joined.Member.WorkspaceID, "name": "", "created": joined.Created}
	// The workspace's name, from the person's own list: a name that cannot be read leaves the join done and unnamed.
	var list struct {
		Workspaces []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"workspaces"`
	}
	// UPSTREAM-BINDS-ONLY lensProvisionWorkspacesBody: none
	if st, raw, err := a.provisionSecretPost(r.Context(), "/v1/provision/workspaces", map[string]string{"identity": c.identity}); err == nil && st == http.StatusOK && json.Unmarshal(raw, &list) == nil {
		for _, ws := range list.Workspaces {
			if ws.ID == joined.Member.WorkspaceID {
				out["name"] = ws.Name
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// provisionSecretPost posts body to a Lens route on the provision secret and answers Lens's status and body; an error
// only when Lens could not be asked.
func (a *app) provisionSecretPost(ctx context.Context, path string, body any) (int, []byte, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.lensBaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(provisionSecretHeader, a.cfg.provisionSecret) // server-side only, never emitted
	resp, err := a.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("lens %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	got, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return resp.StatusCode, got, nil
}
