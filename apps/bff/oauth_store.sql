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

-- B52.3: every tool call an assistant makes on /mcp (connect_limits.go). No foreign key: the trail outlives a
-- revoked connection. The arguments are kept by SHA-256 only.
CREATE TABLE IF NOT EXISTS oauth_tool_calls (
    id          bigserial PRIMARY KEY,
    grant_id    text NOT NULL,
    sub         text NOT NULL,
    client_name text NOT NULL,
    tool        text NOT NULL,
    args_sha256 text NOT NULL,
    result      text NOT NULL,
    at          timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_tool_calls_sub ON oauth_tool_calls (sub, at DESC);

-- B52.2: how a CIMD client may authenticate at the token endpoint, and the resource a code's and a grant's tokens
-- are bound to ('' on a row written before B52.2, when /mcp was the only resource).
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS auth_methods text[] NOT NULL DEFAULT '{}';
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS jwks_uri text NOT NULL DEFAULT '';
ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS resource text NOT NULL DEFAULT '';
ALTER TABLE oauth_grants ADD COLUMN IF NOT EXISTS resource text NOT NULL DEFAULT '';

-- B52.9: when a person last signed out everywhere (signout_everywhere.go). A session sealed before it is never
-- restored from its seal, so a restart cannot undo the sign-out. One row per person, overwritten.
CREATE TABLE IF NOT EXISTS signed_out_everywhere (
    sub text PRIMARY KEY,
    at  timestamptz NOT NULL
);

-- B52.6: the most an assistant may give a new agent, per payment, per day and per month, as the person set it.
CREATE TABLE IF NOT EXISTS connect_agent_ceilings (
    workspace_id         text PRIMARY KEY,
    max_per_request_ulxc bigint NOT NULL CHECK (max_per_request_ulxc > 0),
    daily_limit_ulxc     bigint NOT NULL CHECK (daily_limit_ulxc > 0),
    monthly_limit_ulxc   bigint NOT NULL CHECK (monthly_limit_ulxc > 0),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- B54.21: a connection's ending Lens has not yet recorded (connect_revocations.go): written with the ending, told to Lens's
-- POST /v1/auth/connect-revocations until it answers, then deleted. client_id '' is every assistant of the person's.
CREATE TABLE IF NOT EXISTS connect_revocations_owed (
    user_id   text NOT NULL,
    client_id text NOT NULL,
    owed_at   timestamptz NOT NULL,
    PRIMARY KEY (user_id, client_id)
);
