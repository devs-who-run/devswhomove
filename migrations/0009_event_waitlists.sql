CREATE TABLE event_waitlist (
  event_id TEXT NOT NULL,
  attendee_id TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, attendee_id)
);
CREATE INDEX event_waitlist_order ON event_waitlist(event_id, joined_at);
