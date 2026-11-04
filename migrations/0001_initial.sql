PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  sports TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sport TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  duration REAL NOT NULL CHECK (duration > 0),
  distance REAL CHECK (distance >= 0),
  notes TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  source TEXT NOT NULL CHECK (source IN ('web', 'agent')),
  idempotency_key TEXT,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX activities_feed ON activities(occurred_at DESC);
CREATE INDEX activities_owner ON activities(user_id, occurred_at DESC);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sport TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 200),
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1))
);
CREATE INDEX events_upcoming ON events(starts_at);

CREATE TABLE event_attendees (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE agent_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX tokens_owner ON agent_tokens(user_id);
