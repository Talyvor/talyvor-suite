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

-- B61.19: the ceiling is held in the account's currency, each limit in its minor units. One set before, in µLXC, is moved
-- once to dollars at Lens's peg ($0.10 a LXC, so 100,000 µLXC a cent), whole cents kept and never below one, as Lens moved
-- the agents' rules (lens migration 0393). The µLXC columns are left empty from then on.
ALTER TABLE connect_agent_ceilings ADD COLUMN IF NOT EXISTS currency text CHECK (currency IN ('GBP', 'EUR', 'USD', 'USDC'));
ALTER TABLE connect_agent_ceilings ADD COLUMN IF NOT EXISTS max_per_payment_minor bigint CHECK (max_per_payment_minor > 0);
ALTER TABLE connect_agent_ceilings ADD COLUMN IF NOT EXISTS daily_limit_minor bigint CHECK (daily_limit_minor > 0);
ALTER TABLE connect_agent_ceilings ADD COLUMN IF NOT EXISTS monthly_limit_minor bigint CHECK (monthly_limit_minor > 0);
ALTER TABLE connect_agent_ceilings ALTER COLUMN max_per_request_ulxc DROP NOT NULL, ALTER COLUMN daily_limit_ulxc DROP NOT NULL,
    ALTER COLUMN monthly_limit_ulxc DROP NOT NULL;
UPDATE connect_agent_ceilings SET currency = 'USD', max_per_payment_minor = GREATEST(max_per_request_ulxc / 100000, 1),
    daily_limit_minor = GREATEST(daily_limit_ulxc / 100000, 1), monthly_limit_minor = GREATEST(monthly_limit_ulxc / 100000, 1)
    WHERE currency IS NULL AND max_per_request_ulxc IS NOT NULL;

-- B54.21: a connection's ending Lens has not yet recorded (connect_revocations.go): written with the ending, told to Lens's
-- POST /v1/auth/connect-revocations until it answers, then deleted. client_id '' is every assistant of the person's.
CREATE TABLE IF NOT EXISTS connect_revocations_owed (
    user_id   text NOT NULL,
    client_id text NOT NULL,
    owed_at   timestamptz NOT NULL,
    PRIMARY KEY (user_id, client_id)
);

-- B61.91: every address Lens took for a person's contact check (verification.go), so a move of their number tells each one.
CREATE TABLE IF NOT EXISTS person_emails (
    sub          text NOT NULL,
    email        text NOT NULL,
    last_seen_at timestamptz NOT NULL,
    PRIMARY KEY (sub, email)
);

-- B61.122: the account whose contact check gave each kept address, so closing that account deletes it (number_moves.go).
CREATE TABLE IF NOT EXISTS person_email_accounts (
    sub          text NOT NULL,
    email        text NOT NULL,
    workspace_id text NOT NULL,
    PRIMARY KEY (sub, email, workspace_id),
    FOREIGN KEY (sub, email) REFERENCES person_emails (sub, email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS person_email_accounts_workspace ON person_email_accounts (workspace_id);

-- B28.70: each address a person proved with a code mailed to it, the only addresses Lens is told a role may be taken up by
-- (workspace_roles.go).
CREATE TABLE IF NOT EXISTS person_proved_emails (
    sub       text NOT NULL,
    email     text NOT NULL,
    proved_at timestamptz NOT NULL,
    PRIMARY KEY (sub, email)
);

-- B61.91: each move of a person's number Lens handed over (POST /v1/auth/phone/number-moves/claim, once), and one mail per
-- address it owes (number_moves.go). sub is '' for an identity this BFF did not make. sent_at is set before a mail goes;
-- next_try_at is a sweep on after the sender refused it for now, failed_at when it refused it for good.
CREATE TABLE IF NOT EXISTS number_moves (
    id                text PRIMARY KEY,
    person_id         text NOT NULL,
    sub               text NOT NULL,
    moved_by          text NOT NULL CHECK (moved_by IN ('operator', 'person')),
    moved_at          timestamptz NOT NULL,
    claimed_at        timestamptz NOT NULL,
    sessions_ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS number_move_mails (
    move_id text NOT NULL REFERENCES number_moves (id),
    email   text NOT NULL,
    sent_at     timestamptz,
    next_try_at timestamptz NOT NULL DEFAULT now(),
    failed_at   timestamptz,
    PRIMARY KEY (move_id, email)
);
