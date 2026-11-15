package main

// help_closed.go — B61.65: a closed account's Help chat goes with it.
//
// A person at Talyvor closes an account in Lens by marking its account_closure request done (Lens B59.27); the BFF is
// never told. So the BFF reads it, two ways, and deletes the workspace's help_messages and help_asked rows each time:
//
//   - every helpClosedSweep, every workspace's done closures from Lens's operator inbox
//     (GET /v1/admin/requests?kind=account_closure&state=done, on LENS_OPERATOR_READ_KEY; without it, nothing);
//   - and whenever the workspace's own requests are read (GET /api/workspace/requests) with a closure done in them.
//
// Only the workspace's id stays, in help_closed, and Help takes no more questions from it: a closed account that can
// still sign in cannot fill a new chat, nor have its day's count of questions start again by reading its requests.

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"
)

// helpClosedSweep is how often the operator inbox is read for accounts closed since.
const helpClosedSweep = 10 * time.Minute

// helpClosedPath is Lens's operator inbox, narrowed to the closures a person at Talyvor finished.
const helpClosedPath = "/v1/admin/requests?kind=account_closure&state=done"

// helpClosedAccount is what Help answers a question from an account Talyvor closed.
const helpClosedAccount = "This account is closed, so Help takes no more questions from it."

// closed deletes everything Help keeps for ws, its chat and its day's count of questions, and records ws as closed.
func (s *helpStore) closed(ctx context.Context, ws string) error {
	if s.db != nil {
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()
		for _, q := range []string{
			`INSERT INTO help_closed (workspace_id, closed_at) VALUES ($1, now()) ON CONFLICT (workspace_id) DO NOTHING`,
			`DELETE FROM help_messages WHERE workspace_id = $1`,
			`DELETE FROM help_asked WHERE workspace_id = $1`,
		} {
			if _, err := tx.Exec(ctx, q, ws); err != nil {
				return err
			}
		}
		return tx.Commit(ctx)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.shut[ws] = true
	delete(s.chats, ws)
	for k := range s.asked {
		if strings.HasPrefix(k, ws+"|") {
			delete(s.asked, k)
		}
	}
	return nil
}

// isClosed says whether Talyvor closed ws.
func (s *helpStore) isClosed(ctx context.Context, ws string) (bool, error) {
	if s.db != nil {
		var shut bool
		err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM help_closed WHERE workspace_id = $1)`, ws).Scan(&shut)
		return shut, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.shut[ws], nil
}

// forgetClosedAccountsHelp deletes the Help chat of every account Lens's operator inbox says was closed.
func (a *app) forgetClosedAccountsHelp(ctx context.Context) {
	if a.cfg.operatorReadKey == "" {
		return
	}
	raw, err := a.operatorRead(ctx, helpClosedPath)
	if err != nil {
		log.Printf("bff: help: reading closed accounts: %v", err)
		return
	}
	var got struct {
		Requests []struct {
			WorkspaceID string `json:"workspace_id"`
			Kind        string `json:"kind"`
			State       string `json:"state"`
		} `json:"requests"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		log.Printf("bff: help: reading closed accounts: %v", err)
		return
	}
	for _, r := range got.Requests {
		if r.WorkspaceID == "" || r.Kind != "account_closure" || r.State != "done" {
			continue
		}
		if err := a.help.closed(ctx, r.WorkspaceID); err != nil {
			log.Printf("bff: help: deleting a closed account's chat: %v", err)
		}
	}
}

// keepForgettingClosedAccountsHelp runs forgetClosedAccountsHelp now and every helpClosedSweep until ctx ends.
func (a *app) keepForgettingClosedAccountsHelp(ctx context.Context) {
	t := time.NewTicker(helpClosedSweep)
	defer t.Stop()
	for {
		a.forgetClosedAccountsHelp(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// forgetHelpIfClosed deletes ws's Help chat when its requests, as Lens answered them, hold a closure that is done.
func (a *app) forgetHelpIfClosed(ctx context.Context, ws string, reqs []workspaceRequest) {
	for _, r := range reqs {
		if r.Kind == "account_closure" && r.State == "done" {
			if err := a.help.closed(ctx, ws); err != nil {
				log.Printf("bff: help: deleting a closed account's chat: %v", err)
			}
			return
		}
	}
}
