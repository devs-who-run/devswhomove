CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'atproto')),
  subject TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX oauth_codes_expiry ON oauth_codes(expires_at);

ALTER TABLE agent_tokens ADD COLUMN client_id TEXT;
ALTER TABLE agent_tokens ADD COLUMN refresh_token_hash TEXT;
ALTER TABLE agent_tokens ADD COLUMN refresh_expires_at TEXT;
CREATE UNIQUE INDEX agent_tokens_refresh ON agent_tokens(refresh_token_hash);

ALTER TABLE atproto_agent_tokens ADD COLUMN client_id TEXT;
ALTER TABLE atproto_agent_tokens ADD COLUMN refresh_token_hash TEXT;
ALTER TABLE atproto_agent_tokens ADD COLUMN refresh_expires_at TEXT;
CREATE UNIQUE INDEX atproto_agent_tokens_refresh ON atproto_agent_tokens(refresh_token_hash);
