CREATE TABLE event_waitlist_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  attendee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'left')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  transition_id TEXT
);

INSERT INTO event_waitlist_next (event_id, attendee_id, status, joined_at, updated_at)
SELECT event_id, attendee_id, 'waiting', joined_at, joined_at
FROM event_waitlist
ORDER BY joined_at, event_id, attendee_id;

DROP TABLE event_waitlist;
ALTER TABLE event_waitlist_next RENAME TO event_waitlist;

CREATE UNIQUE INDEX event_waitlist_active_member
  ON event_waitlist(event_id, attendee_id) WHERE status = 'waiting';
CREATE INDEX event_waitlist_order
  ON event_waitlist(event_id, joined_at, id) WHERE status = 'waiting';
CREATE INDEX event_waitlist_transition
  ON event_waitlist(transition_id) WHERE status = 'promoted';

CREATE TABLE atproto_event_capacity_locks (
  event_uri TEXT PRIMARY KEY REFERENCES atproto_events(uri) ON DELETE CASCADE,
  lock_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
