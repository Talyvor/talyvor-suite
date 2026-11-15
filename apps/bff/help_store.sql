-- B61.38: the Help chat (help_chat.go). Applied at every boot, so each statement is idempotent.
-- A message is kept 30 days; what the person typed is kept only after helpRedact cut it.
CREATE TABLE IF NOT EXISTS help_messages (
    id           bigserial PRIMARY KEY,
    workspace_id text NOT NULL,
    by_whom      text NOT NULL,
    body         text NOT NULL,
    page         text NOT NULL,
    team         boolean NOT NULL,
    topic        text NOT NULL,
    at           timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS help_messages_workspace ON help_messages (workspace_id, id);
CREATE INDEX IF NOT EXISTS help_messages_at ON help_messages (at);

-- How many questions a workspace asked on a UTC day, for the day's limit.
CREATE TABLE IF NOT EXISTS help_asked (
    workspace_id text NOT NULL,
    day          date NOT NULL,
    n            integer NOT NULL,
    PRIMARY KEY (workspace_id, day)
);
