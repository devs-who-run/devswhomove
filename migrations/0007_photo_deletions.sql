-- R2 photo keys from deleted activities, kept until the object is removed so cleanup can be retried.
CREATE TABLE photo_deletions (
  key TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL
);
