package main

// B54.21 — the BFF tells Lens when a connection ends, so the Connect tokens Lens minted for it (B52.4, fifteen minutes
// each) stop paying at once rather than when they expire. Lens's POST /v1/auth/connect-revocations (B54.13) takes the
// person's Lens user id and the assistant's client id, or no client id for every assistant of theirs: a disconnect in
// Settings or by the assistant (revokeGrant) names the assistant, and sign out everywhere (endPerson) names none.
//
// The disconnect never waits on Lens. What Lens is owed is written in the same transaction that ends the connection
// (connect_revocations_owed), told at once, and told again every connectRevocationRetry, also after a restart, until
// Lens records it. Without a database it is owed in memory.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// connectRevocation is one thing Lens is owed: userID is the person's Lens user id (their workspace's, as
// mcpSendPayment mints with), clientID the assistant's, or "" for every one.
type connectRevocation struct{ userID, clientID string }

// connectRevocationRetry is how often what Lens has not yet recorded is told again.
const connectRevocationRetry = 30 * time.Second

// connectRevocations is what Lens is owed when the BFF keeps no database, and the one lock that sends it.
type connectRevocations struct {
	sending sync.Mutex
	mu      sync.Mutex
	owed    map[connectRevocation]uint64 // without a database: each owed one's latest owing
	n       uint64
}

// owedRevocation is one row of connect_revocations_owed, or one in memory: at tells a later owing of the same one
// apart, so Lens recording an earlier one does not clear it.
type owedRevocation struct {
	connectRevocation
	at  time.Time
	seq uint64
}

// connectionsEnded is called once the ending is kept: without a database it owes rs in memory; then it tells Lens.
func (a *app) connectionsEnded(rs ...connectRevocation) {
	if a.oauth.db == nil {
		c := &a.oauth.revocations
		c.mu.Lock()
		if c.owed == nil {
			c.owed = map[connectRevocation]uint64{}
		}
		for _, r := range rs {
			if r.userID != "" {
				c.n++
				c.owed[r] = c.n
			}
		}
		c.mu.Unlock()
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		a.tellLensConnectionsEnded(ctx)
	}()
}

// keepTellingLens tells Lens what it is owed now and every connectRevocationRetry until ctx ends.
func (a *app) keepTellingLens(ctx context.Context) {
	t := time.NewTicker(connectRevocationRetry)
	defer t.Stop()
	for {
		a.tellLensConnectionsEnded(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// tellLensConnectionsEnded tells Lens every revocation it is owed, and forgets each one Lens records.
func (a *app) tellLensConnectionsEnded(ctx context.Context) {
	c := &a.oauth.revocations
	c.sending.Lock()
	defer c.sending.Unlock()
	if a.cfg.lensConnectMintKey == "" {
		return // no Connect token is minted without it, and Lens takes a revocation only with it: kept until it is set
	}
	owed, err := a.oauth.db.owedRevocations(ctx)
	if a.oauth.db == nil {
		c.mu.Lock()
		for r, seq := range c.owed {
			owed = append(owed, owedRevocation{connectRevocation: r, seq: seq})
		}
		c.mu.Unlock()
	}
	if err != nil {
		log.Printf("bff: connect revocations owed to Lens could not be read: %v", err)
		return
	}
	for _, o := range owed {
		// UPSTREAM-BINDS-ONLY lensConnectRevocationBody: none
		body, _ := json.Marshal(map[string]string{"user_id": o.userID, "client_id": o.clientID})
		status, _, err := a.mcpLens(ctx, tenant{workspaceID: o.userID, token: a.cfg.lensConnectMintKey},
			lensCall{method: http.MethodPost, path: "/v1/auth/connect-revocations", body: body})
		if err == nil && status != http.StatusCreated && status != http.StatusOK {
			err = fmt.Errorf("Lens answered %d", status)
		}
		if err != nil {
			log.Printf("bff: Lens has not recorded that user %s ended assistant %q, told again in %s: %v", o.userID, o.clientID, connectRevocationRetry, err)
			continue
		}
		if a.oauth.db == nil {
			c.mu.Lock()
			if c.owed[o.connectRevocation] == o.seq {
				delete(c.owed, o.connectRevocation)
			}
			c.mu.Unlock()
		} else if err := a.oauth.db.revocationRecorded(ctx, o); err != nil {
			log.Printf("bff: Lens recorded that user %s ended assistant %q, kept as owed: %v", o.userID, o.clientID, err)
		}
	}
}
