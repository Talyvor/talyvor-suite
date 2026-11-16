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
-- B61.69: a chat is the person's who asked, as helpPersonKey's hash of their identity. The rows kept before have none,
-- and the workspace's owner takes them the first time they open Help (help_chat.go chat); no one else sees them.
ALTER TABLE help_messages ADD COLUMN IF NOT EXISTS person text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS help_messages_person ON help_messages (workspace_id, person, id);
CREATE INDEX IF NOT EXISTS help_messages_at ON help_messages (at);

-- How many questions a workspace asked on a UTC day, for the day's limit: the account's, whoever in it asked.
CREATE TABLE IF NOT EXISTS help_asked (
    workspace_id text NOT NULL,
    day          date NOT NULL,
    n            integer NOT NULL,
    PRIMARY KEY (workspace_id, day)
);

-- B61.65: the accounts Talyvor closed. Their chat and counts are deleted; only the id stays, so Help takes no more
-- questions from them.
CREATE TABLE IF NOT EXISTS help_closed (
    workspace_id text PRIMARY KEY,
    closed_at    timestamptz NOT NULL
);
