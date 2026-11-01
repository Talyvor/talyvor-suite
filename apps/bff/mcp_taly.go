package main

// mcp_taly.go — B45.41: what the desktop app (talyvor-desktop src-tauri/src/mcp.rs) needs of /mcp besides Lens's routes.
// Its Connect token works only here, so Taly, the approvals waiting and the microphone are three tools:
//
//	ask_taly       {"message", "thread": [{"role", "content"}]} → {"reply", "approval_url"?}  Chat's Lens tools, through Lens's model proxy
//	list_approvals {}                                            → {"approvals": [{"id", "title", "amount_minor", "currency", "approval_url"}]}
//	transcribe     {"audio_base64", "mime"}                      → {"text"}  Lens's transcription, as Chat's microphone (chat_voice.go)
//
// Taly is asked and the recording transcribed on the workspace's chat key, tagged Chat's, so each is billed like any Chat
// call. Taly offers the model only the Lens tools Chat may use (chatTools), and its prepare tools only on a connection
// given payments:prepare; a request it prepares is judged as this assistant, "mcp:<client id>", like every Connect tool,
// and waits for the person to approve it in Talyvor.

import (
	"bytes"
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"slices"
	"strings"
	"time"
)

// mcpSaid is a refusal in Talyvor's or Lens's own words, shown to the assistant as it is.
type mcpSaid string

func (s mcpSaid) Error() string { return string(s) }

const (
	talyMaxRounds  = 6  // model calls per question: each round after the first answers the tool calls of the one before
	talyMaxThread  = 40 // earlier turns sent with a question
	talyMaxMessage = 32 << 10
)

// talySystem is B45.6's Taly, in the desktop app rather than on a page.
const talySystem = "You are Taly, Talyvor’s AI assistant, in the Talyvor desktop app. You answer about this workspace's money, " +
	"agents and spending with the tools you have. You cannot pay or approve anything: a payment you prepare waits for the person " +
	"to approve it in Talyvor, so say that it is waiting for their approval, never that it was paid."

// mcpReq is a request carrying only ctx, for the Chat helpers that take one (mcpCall, voiceRelay) and read nothing else of it.
func mcpReq(ctx context.Context) *http.Request {
	r, _ := http.NewRequestWithContext(ctx, http.MethodPost, "/mcp", nil)
	return r
}

type talyTurn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// askTaly answers one question with Chat's Lens tools, running the tool loop Chat runs in the browser (chatApi.ts askChat).
func (a *app) askTaly(ctx context.Context, t tenant, g oauthGrant, args mcpArgs) (map[string]any, error) {
	message := args.str("message")
	if message == "" || len(message) > talyMaxMessage {
		return nil, fmt.Errorf("%w: message is required, at most 32 KB", errMCPArgs)
	}
	var thread []talyTurn
	if raw, ok := args["thread"]; ok && string(raw) != "null" && json.Unmarshal(raw, &thread) != nil {
		return nil, fmt.Errorf("%w: thread is a list of {role, content}", errMCPArgs)
	}
	thread = thread[max(0, len(thread)-talyMaxThread):]
	messages := []any{}
	for _, turn := range thread {
		if turn.Role != "user" && turn.Role != "assistant" {
			return nil, fmt.Errorf("%w: a turn's role is user or assistant", errMCPArgs)
		}
		if strings.TrimSpace(turn.Content) != "" {
			messages = append(messages, turn)
		}
	}
	messages = append(messages, talyTurn{Role: "user", Content: message})

	r := mcpReq(ctx)
	key, err := a.sessionKeyFor(ctx, t)
	if err != nil {
		return nil, err
	}
	model, err := a.talyModel(ctx, t)
	if err != nil {
		return nil, err
	}
	tools := []chatTool{}
	if reply, status, err := a.mcpCall(r, t, "tools/list", map[string]any{}); err == nil && status == http.StatusOK && reply.Error == nil {
		for _, tl := range listedTools("lens", reply) {
			if !slices.Contains(chatTools[tl.Name].session, "client") || grantHas(g, "payments:prepare") {
				tools = append(tools, tl)
			}
		}
	}
	offered := []map[string]any{}
	for _, tl := range tools {
		offered = append(offered, map[string]any{"name": tl.Name, "description": tl.Description, "input_schema": tl.InputSchema})
	}

	approval := ""
	for range talyMaxRounds {
		body := map[string]any{"model": model, "max_tokens": 4096, "system": talySystem, "messages": messages}
		if len(offered) > 0 {
			body["tools"] = offered
		}
		answer, err := a.talyAsk(ctx, key, body)
		if err != nil {
			return nil, err
		}
		var said []string
		results := []map[string]any{}
		for _, c := range answer.Content {
			switch c.Type {
			case "text":
				said = append(said, c.Text)
			case "tool_use":
				text, isErr, link := a.talyTool(r, t, g, c.Name, c.Input)
				approval = cmp.Or(link, approval)
				results = append(results, map[string]any{"type": "tool_result", "tool_use_id": c.ID, "content": text, "is_error": isErr})
			}
		}
		if answer.StopReason != "tool_use" || len(results) == 0 {
			out := map[string]any{"reply": strings.TrimSpace(strings.Join(said, "\n"))}
			if approval != "" {
				out["approval_url"] = approval
			}
			return out, nil
		}
		messages = append(messages, map[string]any{"role": "assistant", "content": answer.Content},
			map[string]any{"role": "user", "content": results})
	}
	return nil, mcpSaid("Taly could not finish answering that. Try asking in smaller steps.")
}

type talyAnswer struct {
	Content []struct {
		Type  string          `json:"type"`
		Text  string          `json:"text,omitempty"`
		ID    string          `json:"id,omitempty"`
		Name  string          `json:"name,omitempty"`
		Input json.RawMessage `json:"input,omitempty"`
	} `json:"content"`
	StopReason string `json:"stop_reason"`
}

// talyAsk is one model call through Lens's proxy on the chat key, tagged Chat's as every Chat question is (stream.go).
func (a *app) talyAsk(ctx context.Context, key string, body map[string]any) (talyAnswer, error) {
	raw, _ := json.Marshal(body)
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.lensBaseURL+"/v1/proxy/anthropic/v1/messages", bytes.NewReader(raw))
	if err != nil {
		return talyAnswer{}, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set(featureHeader, chatFeature)
	resp, err := a.streamClient.Do(req)
	if err != nil {
		return talyAnswer{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	var answer talyAnswer
	var refusal struct {
		Error any `json:"error"`
	}
	dec := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		// Lens's refusal in its own words ("not enough credit …"); a provider's error object is not shown.
		if dec.Decode(&refusal) == nil {
			if s, ok := refusal.Error.(string); ok && s != "" && resp.StatusCode < 500 {
				return talyAnswer{}, mcpSaid(s)
			}
		}
		return talyAnswer{}, fmt.Errorf("lens model proxy answered %d", resp.StatusCode)
	}
	return answer, dec.Decode(&answer)
}

// talyModel is the model Taly is asked on: the newest of Lens's catalog's Anthropic models, a frontier one first, as
// Chat's picker chooses its default (chatApi.ts pickerCatalog).
// shortcut: Anthropic only, since askTaly speaks its Messages API; ask the catalog's default across providers if one is added.
func (a *app) talyModel(ctx context.Context, t tenant) (string, error) {
	status, raw, err := a.mcpLens(ctx, t, lensCall{method: http.MethodGet, path: "/v1/catalog/models"})
	if err == nil && status != http.StatusOK {
		err = fmt.Errorf("lens answered GET /v1/catalog/models %d", status)
	}
	var models []struct {
		ID          string `json:"id"`
		Provider    string `json:"provider"`
		Deprecated  bool   `json:"deprecated"`
		ReleaseDate string `json:"release_date"`
		Tier        string `json:"tier"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &models)
	}
	if err != nil {
		return "", err
	}
	best, bestRank := "", ""
	for _, m := range models {
		if m.Provider != "anthropic" || m.Deprecated || m.Tier == "embedding" || m.ID == "" {
			continue
		}
		rank := map[bool]string{true: "1", false: "0"}[m.Tier == "frontier"] + m.ReleaseDate
		if rank > bestRank {
			best, bestRank = m.ID, rank
		}
	}
	if best == "" {
		return "", mcpSaid("Taly is not set up on this Talyvor yet.")
	}
	return best, nil
}

// talyTool runs one tool call the model made, as Chat's /api/chat/tools/call does for a Lens tool: only a tool Chat may
// use and this connection may call, with the arguments Talyvor sets itself replaced. It answers the text for the model,
// whether Lens refused it, and the approval link of a request it prepared.
func (a *app) talyTool(r *http.Request, t tenant, g oauthGrant, name string, input json.RawMessage) (string, bool, string) {
	spec, ok := chatTools[name]
	prepares := slices.Contains(spec.session, "client")
	if !ok || spec.product != "lens" || prepares && !grantHas(g, "payments:prepare") {
		return "Taly may not use " + name + " here.", true, ""
	}
	args := map[string]any{}
	_ = json.Unmarshal(input, &args)
	for k := range args {
		for _, own := range spec.session {
			if strings.EqualFold(k, own) {
				delete(args, k)
			}
		}
	}
	if prepares {
		key, err := randomToken()
		if err != nil {
			return "Lens could not be asked just now.", true, ""
		}
		args["client"], args["idempotency_key"] = "mcp:"+g.ClientID, key
	}
	reply, status, err := a.mcpCall(r, t, "tools/call", map[string]any{"name": name, "arguments": args})
	if err != nil || status != http.StatusOK || reply.Error != nil {
		return "Lens could not answer just now.", true, ""
	}
	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	_ = json.Unmarshal(reply.Result, &result)
	var text []string
	link := ""
	for _, c := range result.Content {
		if c.Type != "text" {
			continue
		}
		text = append(text, c.Text)
		var prepared struct {
			ApprovalURL string `json:"approval_url"`
		}
		if prepares && json.Unmarshal([]byte(c.Text), &prepared) == nil && prepared.ApprovalURL != "" {
			link = prepared.ApprovalURL
		}
	}
	return strings.Join(text, "\n"), result.IsError, link
}

// transcribe is the desktop app's push-to-talk: the recording goes to Lens's transcription as Chat's microphone's does.
func (a *app) transcribe(ctx context.Context, t tenant, _ oauthGrant, args mcpArgs) (map[string]any, error) {
	audio, err := base64.StdEncoding.DecodeString(args.str("audio_base64"))
	mime := args.str("mime")
	if err != nil || len(audio) == 0 || mime == "" || strings.ContainsAny(mime, "\r\n\"") {
		return nil, fmt.Errorf("%w: audio_base64 is the recording in base64 and mime its type, e.g. audio/webm", errMCPArgs)
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	ext, _, _ := strings.Cut(strings.TrimPrefix(mime, "audio/"), ";")
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="file"; filename="recording.` + ext + `"`},
		"Content-Type":        {mime},
	})
	if err != nil {
		return nil, err
	}
	_, _ = part.Write(audio)
	_ = form.Close()
	cw := newCapturedResponse()
	a.voiceRelay(cw, mcpReq(ctx), t, "/v1/audio/transcriptions", body.Bytes(), form.FormDataContentType())
	var out struct {
		Text  string `json:"text"`
		Error string `json:"error"`
	}
	_ = json.Unmarshal(cw.body.Bytes(), &out)
	switch {
	case cw.status == http.StatusOK:
		return map[string]any{"text": out.Text}, nil
	case cw.status < 500 && out.Error != "":
		return nil, mcpSaid(out.Error)
	}
	return nil, errors.New("lens transcription answered " + fmt.Sprint(cw.status) + ": " + out.Error)
}

type pendingRequest struct {
	ID          string           `json:"id"`
	Summary     string           `json:"summary"`
	ApprovalURL string           `json:"approval_url"`
	Totals      map[string]int64 `json:"totals"`
	CreatedAt   string           `json:"created_at"`
}

// mcpApprovals is Lens's payment requests waiting for the person (B40.39) as the desktop app lists them, newest first.
// shortcut: a request in several currencies shows its first by name; the approval page shows every total.
func mcpApprovals(raw []byte) ([]byte, error) {
	var in struct {
		Requests []pendingRequest `json:"requests"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	slices.SortStableFunc(in.Requests, func(x, y pendingRequest) int { return strings.Compare(y.CreatedAt, x.CreatedAt) })
	out := []map[string]any{}
	for _, r := range in.Requests {
		currency := ""
		for c := range r.Totals {
			if currency == "" || c < currency {
				currency = c
			}
		}
		out = append(out, map[string]any{"id": r.ID, "title": r.Summary, "amount_minor": r.Totals[currency], "currency": currency,
			"approval_url": r.ApprovalURL})
	}
	return json.Marshal(map[string]any{"approvals": out})
}
