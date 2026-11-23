-- Strava webhook events are stored before they are acknowledged, then processed and retried
-- so a transient failure cannot drop an activity deletion or revocation.
CREATE TABLE strava_webhook_events (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX strava_webhook_events_due ON strava_webhook_events(next_attempt_at);
