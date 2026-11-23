-- Strava activities the athlete deleted here are remembered so the re-fetch does not bring them
-- back. The records are removed with the Strava connection, and reconnecting re-imports them.
CREATE TABLE strava_deleted_activities (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, external_id)
);

-- A failed re-fetch waits until `refresh_retry_at` so it cannot crowd out healthy connections.
ALTER TABLE strava_connections ADD COLUMN refresh_retry_at TEXT;
