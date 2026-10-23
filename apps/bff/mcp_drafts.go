package main

// B40.35 — what an assistant asks for that only the person may do: add a payee (create_payee_request) and grant a
// permission mandate (draft_mandate). Neither tool saves or signs anything. Each keeps what the assistant sent as a
// request the Pay screen shows; the payee becomes one only when the person presses Save (POST /api/money/payees), and
// the mandate only when the person's passkey signs it (Lens B40.2 prepare + create).
//
//	GET  /api/money/assistant-requests                      the workspace's waiting requests, newest first
//	POST /api/money/assistant-requests/{id}/dismiss         drop one
//	POST /api/money/assistant-requests/{id}/prepare         a drafted mandate's canonical terms and passkey challenge
//	POST /api/money/assistant-requests/{id}/sign {canonical, assertion}   keep the signed mandate, then drop the request
//
// shortcut: kept in the BFF's memory like the connections that made them, so a restart drops what was waiting; move both
// to Lens when the BFF runs more than one process.

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"
)

// assistantDraftsMax is how many requests one workspace may have waiting: an assistant cannot fill the BFF's memory.
const assistantDraftsMax = 50

type assistantDraft struct {
	ID          string          `json:"id"`
	Kind        string          `json:"kind"` // "payee" or "mandate"
	Assistant   string          `json:"assistant"`
	Details     json.RawMessage `json:"details"` // the payee's details, or the mandate's terms as Lens's prepare wrote them
	CreatedAt   time.Time       `json:"created_at"`
	ConfirmURL  string          `json:"confirm_url"`
	Status      string          `json:"status"`
	workspaceID string
	grantID     string // the connection that asked: revoked, its requests are gone
	expires     time.Time
}

func (d assistantDraft) expiresAt() time.Time { return d.expires }

// mcpPayeeDetails are a payee's details as POST /api/money/payees takes them.
type mcpPayeeDetails struct {
	Name          string `json:"name"`
	Country       string `json:"country"`
	SortCode      string `json:"sort_code,omitempty"`
	AccountNumber string `json:"account_number,omitempty"`
	IBAN          string `json:"iban,omitempty"`
	BIC           string `json:"bic,omitempty"`
	RoutingNumber string `json:"routing_number,omitempty"`
}

// mcpCreatePayeeRequest keeps the payee's details for the person to save; nothing goes to Lens.
func mcpCreatePayeeRequest(_ tenant, _ oauthGrant, _ mcpArgs, raw json.RawMessage) (lensCall, error) {
	var in mcpPayeeDetails
	if err := json.Unmarshal(raw, &in); len(raw) > 0 && err != nil {
		return lensCall{}, fmt.Errorf("%w: %v", errMCPArgs, err)
	}
	in.Name, in.Country = strings.TrimSpace(in.Name), strings.ToUpper(strings.TrimSpace(in.Country))
	if in.Name == "" || len(in.Name) > 140 || len(in.Country) != 2 || in.IBAN == "" && in.AccountNumber == "" {
		return lensCall{}, fmt.Errorf("%w: a payee needs a name, a two-letter country and an IBAN or an account number", errMCPArgs)
	}
	body, err := json.Marshal(in)
	return lensCall{body: body}, err
}

// mcpDraftMandate checks the terms with Lens's prepare, which keeps nothing, and keeps them for the person to sign. The
// mandate is always the person's, and covers only this assistant, whatever the arguments say.
func mcpDraftMandate(_ tenant, g oauthGrant, _ mcpArgs, raw json.RawMessage) (lensCall, error) {
	// The objects go up as the assistant wrote them; what is kept is Lens's canonical form of them (keepDraft), so the
	// person reads exactly the terms Lens bound — not a key Go matched case-insensitively that the screen would not.
	var in struct {
		Principal             map[string]string `json:"principal"`
		Clients               []string          `json:"clients"`
		Scope                 json.RawMessage   `json:"scope"`
		Limits                json.RawMessage   `json:"limits"`
		RequiresApprovalAbove json.RawMessage   `json:"requires_approval_above"`
		NewPayee              json.RawMessage   `json:"new_payee"`
		ExpiresAt             string            `json:"expires_at"`
	}
	if err := json.Unmarshal(raw, &in); len(raw) > 0 && err != nil {
		return lensCall{}, fmt.Errorf("%w: %v", errMCPArgs, err)
	}
	in.Principal = map[string]string{"type": "person", "name": cmp.Or(g.Who.email, "The workspace's owner")}
	in.Clients = []string{"mcp:" + g.ClientID}
	// UPSTREAM-BINDS-ONLY lensPermissionMandatePrepareBody: agent_id, id, valid_from, version, workspace_id
	body, err := json.Marshal(in)
	return lensCall{method: http.MethodPost, path: "/v1/money/permission-mandates/prepare", body: body}, err
}

// keepDraft keeps what a tool drafted for the grant's workspace, and answers the assistant with it. A mandate is kept as
// the canonical terms Lens's prepare answered with.
func (a *app) keepDraft(t tenant, g oauthGrant, kind string, details, lensAnswer []byte) ([]byte, error) {
	if kind == "mandate" {
		var prepared struct {
			Canonical string `json:"canonical"`
		}
		if json.Unmarshal(lensAnswer, &prepared) != nil || prepared.Canonical == "" {
			return nil, errors.New("Talyvor could not check these terms just now. Try again shortly.")
		}
		details = []byte(prepared.Canonical)
	}
	waiting := a.waitingFor(t)
	if len(waiting) >= assistantDraftsMax {
		return nil, fmt.Errorf("%d requests already wait for the person in Talyvor; they have to look at those first", len(waiting))
	}
	id, err := randomToken()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	d := assistantDraft{ID: "ar_" + id, Kind: kind, Assistant: cmp.Or(g.ClientName, "An assistant"), Details: details,
		CreatedAt: now, ConfirmURL: a.cfg.publicBaseURL + "/money/pay", Status: "pending_confirmation",
		workspaceID: t.workspaceID, grantID: g.ID, expires: now.Add(oauthGrantMaxAge)}
	a.oauth.drafts.put(d.ID, d)
	return json.Marshal(d)
}

// handleAssistantRequests — GET /api/money/assistant-requests: what assistants left for this workspace, newest first.
func (a *app) handleAssistantRequests(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	list := a.waitingFor(t)
	slices.SortFunc(list, func(x, y assistantDraft) int { return y.CreatedAt.Compare(x.CreatedAt) })
	writeJSON(w, http.StatusOK, map[string]any{"requests": list})
}

// waitingFor is the workspace's requests whose connection is still there.
func (a *app) waitingFor(t tenant) []assistantDraft {
	return a.oauth.drafts.matching(func(d assistantDraft) bool { return d.workspaceID == t.workspaceID && a.draftLive(d) })
}

func (a *app) draftLive(d assistantDraft) bool {
	_, ok := a.oauth.grants.get(d.grantID)
	return ok
}

// assistantDraftOf is the {id} request when it is this workspace's, of the kind wanted ("" for any).
func (a *app) assistantDraftOf(w http.ResponseWriter, r *http.Request, t tenant, kind string) (assistantDraft, bool) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return assistantDraft{}, false
	}
	d, ok := a.oauth.drafts.get(r.PathValue("id"))
	if !ok || d.workspaceID != t.workspaceID || kind != "" && d.Kind != kind || !a.draftLive(d) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such request from an assistant"})
		return assistantDraft{}, false
	}
	return d, true
}

// handleAssistantRequestDismiss — POST /api/money/assistant-requests/{id}/dismiss.
func (a *app) handleAssistantRequestDismiss(w http.ResponseWriter, r *http.Request, t tenant) {
	if d, ok := a.assistantDraftOf(w, r, t, ""); ok {
		a.oauth.drafts.delete(d.ID)
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleAssistantMandatePrepare — POST /api/money/assistant-requests/{id}/prepare: the drafted terms as Lens will keep
// them, with the challenge the person's passkey signs.
func (a *app) handleAssistantMandatePrepare(w http.ResponseWriter, r *http.Request, t tenant) {
	if d, ok := a.assistantDraftOf(w, r, t, "mandate"); ok {
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/permission-mandates/prepare", d.Details)
	}
}

// handleAssistantMandateSign — POST /api/money/assistant-requests/{id}/sign {canonical, assertion}: Lens keeps the mandate
// only with the passkey's signature over exactly the canonical terms, and the request is gone once it has.
func (a *app) handleAssistantMandateSign(w http.ResponseWriter, r *http.Request, t tenant) {
	d, ok := a.assistantDraftOf(w, r, t, "mandate")
	if !ok {
		return
	}
	var in struct {
		Canonical string            `json:"canonical"`
		Assertion *passkeyAssertion `json:"assertion"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Canonical == "" || in.Assertion == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a mandate is signed with its canonical terms and a passkey's assertion"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensPermissionMandateCreateBody: none
	body, _ := json.Marshal(in)
	status, raw, err := a.mcpLens(r.Context(), t, lensCall{method: http.MethodPost, path: "/v1/money/permission-mandates", body: body})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Talyvor could not keep the mandate just now"})
		return
	}
	if status == http.StatusCreated {
		a.oauth.drafts.delete(d.ID)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}
