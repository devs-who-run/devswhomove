-- Imported activities remember where they came from so re-imports and webhooks stay idempotent.
ALTER TABLE activities ADD COLUMN import_source TEXT
  CHECK (import_source IS NULL OR import_source IN ('strava', 'garmin', 'apple-health', 'file'));
ALTER TABLE activities ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX activities_external
  ON activities(user_id, import_source, external_id) WHERE external_id IS NOT NULL;

-- One Strava athlete per account. Tokens are AES-GCM encrypted with STRAVA_TOKEN_KEY.
-- Sync cursors are Unix seconds: newer activities come after `newest_cursor`, history before `oldest_cursor`.
CREATE TABLE strava_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL UNIQUE,
  encrypted_tokens TEXT NOT NULL,
  scope TEXT NOT NULL,
  newest_cursor INTEGER NOT NULL,
  oldest_cursor INTEGER NOT NULL,
  history_complete INTEGER NOT NULL DEFAULT 0 CHECK (history_complete IN (0, 1)),
  last_synced_at TEXT,
  created_at TEXT NOT NULL
);
