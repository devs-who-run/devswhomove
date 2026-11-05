CREATE TABLE atproto_accounts (
  did TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  sports TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE INDEX atproto_accounts_handle ON atproto_accounts(handle, updated_at DESC, did);

CREATE TABLE atproto_oauth_states (
  state TEXT PRIMARY KEY,
  encrypted_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE atproto_oauth_sessions (
  did TEXT PRIMARY KEY,
  encrypted_session TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE atproto_sessions (
  token_hash TEXT PRIMARY KEY,
  did TEXT NOT NULL REFERENCES atproto_accounts(did) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX atproto_sessions_expiry ON atproto_sessions(expires_at);

CREATE TABLE atproto_oauth_locks (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE atproto_activities (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL REFERENCES atproto_accounts(did) ON DELETE CASCADE,
  rkey TEXT NOT NULL,
  record_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX atproto_activities_feed ON atproto_activities(indexed_at DESC);
CREATE INDEX atproto_activities_owner ON atproto_activities(did);

CREATE TABLE atproto_events (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL REFERENCES atproto_accounts(did) ON DELETE CASCADE,
  rkey TEXT NOT NULL,
  record_json TEXT NOT NULL,
  title TEXT NOT NULL,
  sport TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 200),
  indexed_at TEXT NOT NULL
);
CREATE INDEX atproto_events_upcoming ON atproto_events(starts_at);

CREATE TABLE atproto_event_attendees (
  event_uri TEXT NOT NULL REFERENCES atproto_events(uri) ON DELETE CASCADE,
  attendee_id TEXT NOT NULL,
  PRIMARY KEY (event_uri, attendee_id)
);

CREATE TABLE atproto_external_event_attendees (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  attendee_id TEXT NOT NULL,
  PRIMARY KEY (event_id, attendee_id)
);

CREATE TABLE atproto_agent_tokens (
  id TEXT PRIMARY KEY,
  did TEXT NOT NULL REFERENCES atproto_accounts(did) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX atproto_tokens_owner ON atproto_agent_tokens(did);
