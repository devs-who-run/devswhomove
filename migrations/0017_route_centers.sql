-- Centre of each stored (already trimmed) route's bounding box, used only to find routes near a
-- searched area. Rounded to about 100 m so the column is never more precise than the route itself.
ALTER TABLE activities ADD COLUMN route_lat REAL;
ALTER TABLE activities ADD COLUMN route_lng REAL;
CREATE INDEX activities_route_center ON activities(route_lat, route_lng)
  WHERE route_lat IS NOT NULL;

UPDATE activities SET
  route_lat = (
    SELECT round((MIN(json_extract(p.value, '$[0]')) + MAX(json_extract(p.value, '$[0]'))) / 2, 3)
    FROM json_each(activities.route_json) s, json_each(s.value) p
  ),
  route_lng = (
    SELECT round((MIN(json_extract(p.value, '$[1]')) + MAX(json_extract(p.value, '$[1]'))) / 2, 3)
    FROM json_each(activities.route_json) s, json_each(s.value) p
  )
WHERE route_json IS NOT NULL;
