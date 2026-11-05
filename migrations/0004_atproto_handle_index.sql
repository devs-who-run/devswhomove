PRAGMA defer_foreign_keys = ON;

CREATE TABLE atproto_sessions_backup AS SELECT * FROM atproto_sessions;
CREATE TABLE atproto_activities_backup AS SELECT * FROM atproto_activities;
CREATE TABLE atproto_events_backup AS SELECT * FROM atproto_events;
CREATE TABLE atproto_event_attendees_backup AS SELECT * FROM atproto_event_attendees;
CREATE TABLE atproto_agent_tokens_backup AS SELECT * FROM atproto_agent_tokens;

CREATE TABLE atproto_accounts_replacement (
  did TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  sports TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

INSERT INTO atproto_accounts_replacement (did, handle, name, avatar, bio, sports, updated_at)
SELECT did, handle, name, avatar, bio, sports, updated_at FROM atproto_accounts;

DROP TABLE atproto_accounts;
ALTER TABLE atproto_accounts_replacement RENAME TO atproto_accounts;

INSERT INTO atproto_sessions (token_hash, did, expires_at)
SELECT token_hash, did, expires_at FROM atproto_sessions_backup;
INSERT INTO atproto_activities (uri, did, rkey, record_json, indexed_at)
SELECT uri, did, rkey, record_json, indexed_at FROM atproto_activities_backup;
INSERT INTO atproto_events
  (uri, did, rkey, record_json, title, sport, starts_at, location, description, level, capacity, indexed_at)
SELECT uri, did, rkey, record_json, title, sport, starts_at, location, description, level, capacity, indexed_at
FROM atproto_events_backup;
INSERT INTO atproto_event_attendees (event_uri, attendee_id)
SELECT event_uri, attendee_id FROM atproto_event_attendees_backup;
INSERT INTO atproto_agent_tokens (id, did, token_hash, name, scopes, created_at, expires_at)
SELECT id, did, token_hash, name, scopes, created_at, expires_at FROM atproto_agent_tokens_backup;

DROP TABLE atproto_sessions_backup;
DROP TABLE atproto_activities_backup;
DROP TABLE atproto_events_backup;
DROP TABLE atproto_event_attendees_backup;
DROP TABLE atproto_agent_tokens_backup;

CREATE INDEX atproto_accounts_handle ON atproto_accounts(handle, updated_at DESC, did);
