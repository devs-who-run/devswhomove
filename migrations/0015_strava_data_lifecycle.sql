-- Strava data may be kept only while it is re-confirmed from Strava. `fetched_at` records when
-- Strava last returned each imported activity, and rows not re-confirmed within 7 days are purged.
ALTER TABLE activities ADD COLUMN fetched_at TEXT;
UPDATE activities SET fetched_at = created_at WHERE import_source = 'strava';
CREATE INDEX activities_strava_fetched ON activities(fetched_at) WHERE import_source = 'strava';

-- Rolling re-fetch of each athlete's history: `refresh_cursor` is the Unix-seconds `before`
-- cursor of a pass in progress (NULL when idle) and `refreshed_at` is when the last pass finished.
ALTER TABLE strava_connections ADD COLUMN refresh_cursor INTEGER;
ALTER TABLE strava_connections ADD COLUMN refreshed_at TEXT;
