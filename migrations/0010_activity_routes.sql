-- Trimmed, simplified GPS routes: a JSON array of segments of [latitude, longitude] pairs.
-- Raw GPX files are never uploaded, and privacy zones are removed in the browser before upload.
ALTER TABLE activities ADD COLUMN route_json TEXT;
ALTER TABLE activities ADD COLUMN route_visibility TEXT NOT NULL DEFAULT 'hidden'
  CHECK (route_visibility IN ('hidden', 'public'));
