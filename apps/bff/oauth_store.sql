-- B52.1: Talyvor Connect's OAuth state (oauth_store.go). Applied at every boot, so each statement is idempotent.
-- Codes and tokens are kept by SHA-256 only; no Lens credential is stored.
CREATE TABLE IF NOT EXISTS oauth_clients (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    redirect_uris text[] NOT NULL,
    expires_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
    hash         text PRIMARY KEY,
    client_id    text NOT NULL,
    client_name  text NOT NULL,
    redirect_uri text NOT NULL,
    challenge    text NOT NULL,
    scope        text NOT NULL,
    sub          text NOT NULL,
    email        text NOT NULL,
    workspace_id text NOT NULL,
    synthetic    boolean NOT NULL,
    expires_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_grants (
    id           text PRIMARY KEY,
    client_id    text NOT NULL,
    client_name  text NOT NULL,
    scope        text NOT NULL,
    sub          text NOT NULL,
    email        text NOT NULL,
    workspace_id text NOT NULL,
    synthetic    boolean NOT NULL,
    created_at   timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL,
    ends_at      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_grants_sub ON oauth_grants (sub);

CREATE TABLE IF NOT EXISTS oauth_tokens (
    hash       text PRIMARY KEY,
    refresh    boolean NOT NULL,
    grant_id   text NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
    used       boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);
