package main

// B52.1 — Talyvor Connect's sign-ins survive a BFF restart. With BFF_DATABASE_URL set, every client, code,
// grant and token oauth.go hands out is written to Postgres before the caller sees it, and the live ones are
// read back at boot. The process's maps stay the working copy (one BFF serves app.talyvor.com); the table is
// what a restart starts from, so a write that fails fails the request rather than leave a sign-in that a
// restart would silently forget.
//
// Codes and tokens are kept by their SHA-256 only (tokenKey), never the value. A grant's Lens credential is
// not stored at all: after a restart mcpTenant mints a fresh one by provisioning, as it does near expiry.
// Without BFF_DATABASE_URL every method here is a no-op and Connect behaves as before: memory only.

import (
	"context"
	_ "embed"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed oauth_store.sql
var oauthSchema string

type oauthDB struct{ pool *pgxpool.Pool }

// openOAuthDB connects, creates the tables if they are missing and forgets what has expired.
func openOAuthDB(ctx context.Context, dsn string) (*oauthDB, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, oauthSchema); err != nil {
		pool.Close()
		return nil, fmt.Errorf("create the oauth tables: %w", err)
	}
	d := &oauthDB{pool: pool}
	if err := d.sweep(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return d, nil
}

func (d *oauthDB) close() {
	if d != nil {
		d.pool.Close()
	}
}

// sweep deletes expired rows; a grant's tokens go with it (ON DELETE CASCADE).
func (d *oauthDB) sweep(ctx context.Context) error {
	if d == nil {
		return nil
	}
	_, err := d.pool.Exec(ctx, `
		DELETE FROM oauth_clients WHERE expires_at < now();
		DELETE FROM oauth_codes WHERE expires_at < now();
		DELETE FROM oauth_grants WHERE expires_at < now();
		DELETE FROM oauth_tokens WHERE expires_at < now();`)
	return err
}

// load puts every live row back into o's maps: what a restarted BFF knows on its first request.
func (d *oauthDB) load(ctx context.Context, o *oauthServer) error {
	if d == nil {
		return nil
	}
	rows, _ := d.pool.Query(ctx, `SELECT id, name, redirect_uris, expires_at FROM oauth_clients WHERE expires_at > now()`)
	clients, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (c oauthClient, err error) {
		return c, r.Scan(&c.id, &c.name, &c.redirectURIs, &c.expires)
	})
	if err != nil {
		return fmt.Errorf("load oauth clients: %w", err)
	}
	for _, c := range clients {
		o.clients.put(c.id, c)
	}

	rows, _ = d.pool.Query(ctx, `SELECT hash, client_id, client_name, redirect_uri, challenge, scope, sub, email, workspace_id,
		synthetic, expires_at FROM oauth_codes WHERE expires_at > now()`)
	type keyed struct {
		key  string
		code oauthCode
	}
	codes, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (k keyed, err error) {
		c := &k.code
		return k, r.Scan(&k.key, &c.clientID, &c.clientName, &c.redirectURI, &c.challenge, &c.scope,
			&c.who.sub, &c.who.email, &c.who.workspaceID, &c.who.synthetic, &c.expires)
	})
	if err != nil {
		return fmt.Errorf("load oauth codes: %w", err)
	}
	for _, k := range codes {
		o.codes.put(k.key, k.code)
	}

	rows, _ = d.pool.Query(ctx, `SELECT id, client_id, client_name, scope, sub, email, workspace_id, synthetic,
		created_at, last_used_at, expires_at, ends_at FROM oauth_grants WHERE expires_at > now()`)
	grants, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (g oauthGrant, err error) {
		return g, r.Scan(&g.ID, &g.ClientID, &g.ClientName, &g.Scope, &g.Who.sub, &g.Who.email, &g.Who.workspaceID,
			&g.Who.synthetic, &g.Created, &g.LastUsed, &g.expires, &g.endsAt)
	})
	if err != nil {
		return fmt.Errorf("load oauth grants: %w", err)
	}
	for _, g := range grants {
		o.grants.put(g.ID, g)
	}

	rows, _ = d.pool.Query(ctx, `SELECT hash, refresh, grant_id, used, expires_at FROM oauth_tokens WHERE expires_at > now()`)
	type token struct {
		key     string
		refresh bool
		t       oauthToken
	}
	tokens, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (k token, err error) {
		return k, r.Scan(&k.key, &k.refresh, &k.t.grantID, &k.t.used, &k.t.expires)
	})
	if err != nil {
		return fmt.Errorf("load oauth tokens: %w", err)
	}
	for _, k := range tokens {
		if k.refresh {
			o.refresh.put(k.key, k.t)
		} else {
			o.access.put(k.key, k.t)
		}
	}
	return nil
}

func (d *oauthDB) saveClient(ctx context.Context, c oauthClient) error {
	if d == nil {
		return nil
	}
	_, err := d.pool.Exec(ctx, `INSERT INTO oauth_clients (id, name, redirect_uris, expires_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, redirect_uris = EXCLUDED.redirect_uris, expires_at = EXCLUDED.expires_at`,
		c.id, c.name, c.redirectURIs, c.expires)
	return err
}

func (d *oauthDB) saveCode(ctx context.Context, key string, c oauthCode) error {
	if d == nil {
		return nil
	}
	_, err := d.pool.Exec(ctx, `INSERT INTO oauth_codes (hash, client_id, client_name, redirect_uri, challenge, scope, sub, email,
		workspace_id, synthetic, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		key, c.clientID, c.clientName, c.redirectURI, c.challenge, c.scope, c.who.sub, c.who.email, c.who.workspaceID,
		c.who.synthetic, c.expires)
	return err
}

// takeCode deletes a code's row; it reports false when the row was already gone, so a code is spent once even if
// two requests carry it.
func (d *oauthDB) takeCode(ctx context.Context, key string) (bool, error) {
	if d == nil {
		return true, nil
	}
	tag, err := d.pool.Exec(ctx, `DELETE FROM oauth_codes WHERE hash = $1`, key)
	return tag.RowsAffected() == 1, err
}

func (d *oauthDB) saveGrant(ctx context.Context, g oauthGrant) error {
	if d == nil {
		return nil
	}
	_, err := d.pool.Exec(ctx, `INSERT INTO oauth_grants (id, client_id, client_name, scope, sub, email, workspace_id, synthetic,
		created_at, last_used_at, expires_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (id) DO UPDATE SET last_used_at = EXCLUDED.last_used_at, expires_at = EXCLUDED.expires_at`,
		g.ID, g.ClientID, g.ClientName, g.Scope, g.Who.sub, g.Who.email, g.Who.workspaceID, g.Who.synthetic,
		g.Created, g.LastUsed, g.expires, g.endsAt)
	return err
}

func (d *oauthDB) deleteGrant(ctx context.Context, id string) error {
	if d == nil {
		return nil
	}
	_, err := d.pool.Exec(ctx, `DELETE FROM oauth_grants WHERE id = $1`, id)
	return err
}

func (d *oauthDB) saveToken(ctx context.Context, key string, refresh bool, t oauthToken) error {
	if d == nil {
		return nil
	}
	_, err := d.pool.Exec(ctx, `INSERT INTO oauth_tokens (hash, refresh, grant_id, used, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		key, refresh, t.grantID, t.used, t.expires)
	return err
}

// useRefresh marks a refresh token used and reports whether it already was: the replay check, held by the table
// so a restart between two uses still catches the second.
func (d *oauthDB) useRefresh(ctx context.Context, key string) (wasUsed bool, err error) {
	if d == nil {
		return false, nil
	}
	err = d.pool.QueryRow(ctx, `UPDATE oauth_tokens t SET used = true FROM (SELECT hash, used FROM oauth_tokens
		WHERE hash = $1 AND refresh FOR UPDATE) old WHERE t.hash = old.hash RETURNING old.used`, key).Scan(&wasUsed)
	if err == pgx.ErrNoRows {
		// Its row went with its grant: refuse it as a replay is refused.
		return true, nil
	}
	return wasUsed, err
}
