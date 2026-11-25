-- OpenStreetMap routes found through Overpass, kept per ~5 km grid cell, radius and route group so
-- Explore can keep showing the last good result while the public Overpass servers are down.
CREATE TABLE osm_route_cache (
  cache_key TEXT PRIMARY KEY,
  -- JSON array of routes from the last successful lookup, or NULL until one succeeds.
  routes_json TEXT,
  fetched_at TEXT,
  -- Set when the latest refresh failed, so a struggling server is not retried on every view.
  failed_at TEXT
);
CREATE INDEX osm_route_cache_fetched ON osm_route_cache(fetched_at);
