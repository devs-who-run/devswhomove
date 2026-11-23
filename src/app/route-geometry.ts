/**
 * Privacy trimming, simplification and SVG drawing for GPS routes. Tracks are read by
 * activity-import-parsers.ts; nothing here touches the network.
 */
/** A route as one or more line segments of [latitude, longitude] pairs. */
export type RouteSegments = [number, number][][];

export interface TrackPoint {
  lat: number;
  lng: number;
  /** Milliseconds since the epoch, when the file records it. */
  time: number | null;
}

export const MAX_ROUTE_POINTS = 500;
/** The Worker rejects routes with more segments than this. */
export const MAX_ROUTE_SEGMENTS = 50;
export const TRIM_OPTIONS = [200, 500, 1000] as const;
export type TrimMeters = (typeof TRIM_OPTIONS)[number];

const EARTH_RADIUS_M = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Remove every point within `meters` of where the track starts or ends, so a route never reveals
 * a home or office. Points that pass near those places mid-route are removed too, which splits the
 * route into separate segments.
 */
export function trimPrivacyZones(points: TrackPoint[], meters: number): RouteSegments {
  const start = points[0];
  const end = points.at(-1)!;
  const segments: RouteSegments = [];
  let current: [number, number][] = [];
  for (const point of points) {
    if (distanceMeters(point, start) < meters || distanceMeters(point, end) < meters) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push([point.lat, point.lng]);
  }
  if (current.length) segments.push(current);
  return segments.filter((segment) => segment.length >= 2);
}

/** Perpendicular distance in metres from p to the line a→b, using a local flat projection. */
function offsetMeters(p: [number, number], a: [number, number], b: [number, number]): number {
  const scale = Math.cos(toRadians(a[0])) * 111_320;
  const ax = a[1] * scale;
  const ay = a[0] * 110_540;
  const dx = b[1] * scale - ax;
  const dy = b[0] * 110_540 - ay;
  const px = p[1] * scale - ax;
  const py = p[0] * 110_540 - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

/** Ramer–Douglas–Peucker line simplification. */
function simplifyLine(line: [number, number][], tolerance: number): [number, number][] {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let furthest = -1;
    let furthestDistance = tolerance;
    for (let index = first + 1; index < last; index++) {
      const distance = offsetMeters(line[index], line[first], line[last]);
      if (distance > furthestDistance) {
        furthest = index;
        furthestDistance = distance;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return line.filter((_, index) => keep[index]);
}

/**
 * Simplify segments until they fit in `maxPoints` and `maxSegments`, rounding coordinates to about
 * a metre. Segments are never joined, so privacy gaps stay gaps; when there are too many, the
 * shortest are dropped and the rest keep their order.
 */
export function simplifyRoute(
  segments: RouteSegments,
  maxPoints = MAX_ROUTE_POINTS,
  maxSegments = MAX_ROUTE_SEGMENTS,
): RouteSegments {
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  const kept =
    segments.length <= maxSegments
      ? segments
      : segments
          .map((segment, index) => ({ segment, index, length: routeLength(segment) }))
          .sort((a, b) => b.length - a.length)
          .slice(0, maxSegments)
          .sort((a, b) => a.index - b.index)
          .map(({ segment }) => segment);
  const rounded = kept.map((segment) =>
    segment.map(([lat, lng]) => [round(lat), round(lng)] as [number, number]),
  );
  const fits = (candidate: RouteSegments) =>
    candidate.length <= maxSegments &&
    candidate.reduce((sum, segment) => sum + segment.length, 0) <= maxPoints;
  let result = rounded;
  for (let tolerance = 2; tolerance <= 10_000; tolerance *= 2) {
    result = rounded.map((segment) => simplifyLine(segment, tolerance));
    if (fits(result)) return result;
  }
  // Only reachable when segments alone exceed the point budget: keep each one's end points.
  return result
    .slice(0, Math.min(maxSegments, Math.floor(maxPoints / 2)))
    .map((segment) => [segment[0], segment.at(-1)!]);
}

/** Length of a segment in metres. */
function routeLength(segment: [number, number][]): number {
  let meters = 0;
  for (let index = 1; index < segment.length; index++) {
    const [lat, lng] = segment[index - 1];
    meters += distanceMeters({ lat, lng }, { lat: segment[index][0], lng: segment[index][1] });
  }
  return meters;
}

/** Prepare the trimmed, simplified route that is safe to upload. */
export function shareableRoute(points: TrackPoint[], trimMeters: number): RouteSegments {
  return simplifyRoute(trimPrivacyZones(points, trimMeters));
}

export interface RouteDrawing {
  width: number;
  height: number;
  paths: string[];
  start: [number, number] | null;
  end: [number, number] | null;
}

/** Fit route segments into an SVG box, preserving shape with an equirectangular projection. */
export function drawRoute(
  segments: RouteSegments,
  width = 320,
  height = 160,
  padding = 12,
): RouteDrawing {
  const points = segments.flat();
  if (!points.length) return { width, height, paths: [], start: null, end: null };
  const midLat = (Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[0]))) / 2;
  const xScale = Math.cos(toRadians(midLat));
  const xs = points.map((p) => p[1] * xScale);
  const ys = points.map((p) => -p[0]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const scale = Math.min(
    (width - padding * 2) / (maxX - minX || 1),
    (height - padding * 2) / (maxY - minY || 1),
  );
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const project = ([lat, lng]: [number, number]): [number, number] => [
    Math.round((offsetX + (lng * xScale - minX) * scale) * 10) / 10,
    Math.round((offsetY + (-lat - minY) * scale) * 10) / 10,
  ];
  return {
    width,
    height,
    paths: segments.map((segment) =>
      segment
        .map(project)
        .map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`)
        .join(' '),
    ),
    start: project(points[0]),
    end: project(points.at(-1)!),
  };
}
