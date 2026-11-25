/**
 * Named walking, running and cycling routes mapped in OpenStreetMap, found with the Overpass API.
 * Only the Worker talks to Overpass, with a location rounded to a ~5 km grid, so OpenStreetMap
 * never sees a member's IP address or precise position. Results are stored in D1, refreshed weekly,
 * and the last good result keeps showing while Overpass is down.
 */
import { distanceMeters, simplifyRoute, type RouteSegments } from '../src/app/route-geometry';
import type { MappedRoutesResult, Sport } from '../src/app/models';
import { distanceKm, type ExploreOrigin } from './explore';

/** Public Overpass instances, tried in order; the main one is often at capacity. */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const DAY_MS = 24 * 60 * 60 * 1000;
/** Refresh stored routes after a week; OpenStreetMap routes change slowly. */
const FRESH_MS = 7 * DAY_MS;
/** After a failed refresh, wait before asking Overpass again. */
const RETRY_AFTER_MS = 10 * 60 * 1000;
/** Forget areas no one has looked at for this long. */
const PRUNE_AFTER_MS = 90 * DAY_MS;
const TIMEOUT_MS = 20_000;
/** Long-distance trails (pilgrim ways, EuroVelo) are not useful as a local outing. */
const MAX_SPAN_KM = 50;
const MAX_ROUTES = 12;
const GRID_DEGREES = 0.05;

const FOOT = ['running', 'fitness_trail', 'foot', 'hiking', 'walking'] as const;
const BIKE = ['bicycle', 'mtb'] as const;
type Group = 'all' | 'foot' | 'bike';

/** Which OpenStreetMap route types suit a sport, or null when none do. */
export function routeGroup(sport: Sport | null): Group | null {
  if (!sport) return 'all';
  if (sport === 'Running' || sport === 'Walking') return 'foot';
  if (sport === 'Cycling') return 'bike';
  return null;
}

const kinds = (group: Group): readonly string[] =>
  group === 'foot' ? FOOT : group === 'bike' ? BIKE : [...FOOT, ...BIKE];

interface OverpassElement {
  id: number;
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  /** Positions can be null where Overpass could not resolve a node. */
  members?: { type: string; geometry?: unknown[] }[];
}

/** A route relation near a grid cell, before its outline is fetched. */
interface Candidate {
  id: number;
  name: string;
  kind: string;
  center: ExploreOrigin;
}

interface Outline {
  lengthKm: number;
  segments: RouteSegments;
}

/** What one `osm_route_cache` row holds for a grid cell, radius and route group. */
interface Stored {
  candidates: Candidate[];
  /** Outlines fetched so far, by relation id. Fetched lazily for the routes people look at. */
  outlines: Record<string, Outline>;
}

async function overpass(query: string, userAgent: string): Promise<OverpassElement[]> {
  let failure: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const host = new URL(url).host;
      if (!response.ok) throw new Error(`${host} responded ${response.status}`);
      const result = (await response.json()) as { elements?: OverpassElement[]; remark?: string };
      // Overpass reports timeouts and memory limits as a remark on a 200 response with partial
      // elements; treat those as failures so they are retried rather than stored.
      if (result.remark && /runtime error/i.test(result.remark))
        throw new Error(`${host}: ${result.remark.slice(0, 200)}`);
      return result.elements ?? [];
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

/** Join a relation's ways end to end, so a route made of hundreds of ways draws as few lines. */
export function joinWays(ways: [number, number][][]): RouteSegments {
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  const joined: RouteSegments = [];
  for (const way of ways) {
    const current = joined.at(-1);
    if (current && same(current.at(-1)!, way[0])) current.push(...way.slice(1));
    else if (current && same(current.at(-1)!, way.at(-1)!))
      current.push(...[...way].reverse().slice(1));
    else if (current && joined.length === 1 && current.length === ways[0].length) {
      // The first way may be stored backwards; flip it when that lets the second one connect.
      if (same(current[0], way[0])) joined[0] = [...[...current].reverse(), ...way.slice(1)];
      else if (same(current[0], way.at(-1)!))
        joined[0] = [...[...current].reverse(), ...[...way].reverse().slice(1)];
      else joined.push([...way]);
    } else joined.push([...way]);
  }
  return joined;
}

/**
 * Turn a way's geometry into runs of valid positions. A missing or malformed position splits the
 * way, so a line is never drawn across the gap; runs shorter than two points are dropped.
 */
export function validRuns(geometry: unknown[]): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  const close = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (const position of geometry) {
    const { lat, lon } = (position ?? {}) as { lat?: unknown; lon?: unknown };
    if (
      typeof lat === 'number' &&
      typeof lon === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    )
      run.push([lat, lon]);
    else close();
  }
  close();
  return runs;
}

/** List the named, local route relations around a grid cell (tags and bounds only). */
async function listCandidates(
  cell: ExploreOrigin,
  radiusKm: number,
  group: Group,
  userAgent: string,
): Promise<Candidate[]> {
  // Cover every point within the radius of any origin that rounds to this cell.
  const aroundMeters = Math.round((radiusKm + 5) * 1000);
  const pattern = kinds(group).join('|');
  const listed = await overpass(
    `[out:json][timeout:15];relation[type=route][route~"^(${pattern})$"]` +
      `(around:${aroundMeters},${cell.lat},${cell.lng});out tags bb qt 500;`,
    userAgent,
  );
  const candidates: Candidate[] = [];
  for (const element of listed) {
    const name = element.tags?.['name'] || element.tags?.['ref'];
    const kind = element.tags?.['route'];
    const bounds = element.bounds;
    if (!name || !kind || !bounds) continue;
    const span = distanceKm(
      { lat: bounds.minlat, lng: bounds.minlon },
      { lat: bounds.maxlat, lng: bounds.maxlon },
    );
    if (span > MAX_SPAN_KM) continue;
    candidates.push({
      id: element.id,
      name: name.slice(0, 120),
      kind,
      center: {
        lat: (bounds.minlat + bounds.maxlat) / 2,
        lng: (bounds.minlon + bounds.maxlon) / 2,
      },
    });
  }
  return candidates;
}

/** Fetch, join and simplify the outlines of some route relations. */
async function fetchOutlines(ids: number[], userAgent: string): Promise<Record<string, Outline>> {
  const detailed = await overpass(
    `[out:json][timeout:20];relation(id:${ids.join(',')});out geom qt;`,
    userAgent,
  );
  const outlines: Record<string, Outline> = {};
  for (const element of detailed) {
    const segments = joinWays(
      (element.members ?? [])
        .filter((member) => member.type === 'way' && Array.isArray(member.geometry))
        .flatMap((member) => validRuns(member.geometry!)),
    );
    if (!segments.length) continue;
    let meters = 0;
    for (const segment of segments)
      for (let index = 1; index < segment.length; index++)
        meters += distanceMeters(
          { lat: segment[index - 1][0], lng: segment[index - 1][1] },
          { lat: segment[index][0], lng: segment[index][1] },
        );
    outlines[element.id] = {
      lengthKm: Math.round(meters / 100) / 10,
      segments: simplifyRoute(segments, 300, 50),
    };
  }
  return outlines;
}

/** Routes mapped in OpenStreetMap within `radiusKm` of `origin`, nearest first. */
export async function mappedRoutes(
  db: D1Database,
  origin: ExploreOrigin,
  radiusKm: number,
  sport: Sport | null,
  appUrl: string,
  now = Date.now(),
): Promise<MappedRoutesResult> {
  const group = routeGroup(sport);
  if (!group) return { status: 'ok', routes: [] };
  const snap = (value: number) => Math.round(value / GRID_DEGREES) * GRID_DEGREES;
  const cell = {
    lat: Number(snap(origin.lat).toFixed(2)),
    lng: Number(snap(origin.lng).toFixed(2)),
  };
  const userAgent = `DevsWhoMove/1.0 (+${new URL(appUrl).origin})`;
  const stamp = new Date(now).toISOString();
  const key = `v2/${group}/${radiusKm}/${cell.lat}/${cell.lng}`;
  const row = await db
    .prepare('SELECT routes_json, fetched_at, failed_at FROM osm_route_cache WHERE cache_key = ?')
    .bind(key)
    .first<{ routes_json: string | null; fetched_at: string | null; failed_at: string | null }>();
  const age = (value: string | null) => (value ? now - Date.parse(value) : Infinity);
  let stored: Stored | null = row?.routes_json ? JSON.parse(row.routes_json) : null;
  let fetchedAt = row?.fetched_at ?? null;
  let failedAt = row?.failed_at ?? null;
  let changed = false;
  const mayRetry = () => age(failedAt) > RETRY_AFTER_MS;
  const fail = (error: unknown) => {
    console.warn('OpenStreetMap route lookup failed', error);
    failedAt = stamp;
    changed = true;
  };

  // Refresh the candidate list weekly, unless a lookup failed moments ago.
  let stale = age(fetchedAt) > FRESH_MS;
  if (stale && mayRetry()) {
    try {
      // Outlines are dropped with the old list, since the routes themselves may have changed.
      stored = { candidates: await listCandidates(cell, radiusKm, group, userAgent), outlines: {} };
      fetchedAt = stamp;
      failedAt = null;
      stale = false;
      changed = true;
    } catch (error) {
      fail(error);
    }
  }

  // Choose the routes nearest this searcher, then fetch any outlines not stored yet.
  const nearest = (stored?.candidates ?? [])
    .map((candidate) => ({ candidate, distance: distanceKm(origin, candidate.center) }))
    .filter(({ distance }) => distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_ROUTES);
  const missing = nearest.filter(({ candidate }) => !stored!.outlines[candidate.id]);
  if (stored && missing.length && mayRetry()) {
    try {
      Object.assign(
        stored.outlines,
        await fetchOutlines(
          missing.map(({ candidate }) => candidate.id),
          userAgent,
        ),
      );
      changed = true;
    } catch (error) {
      fail(error);
    }
  }

  if (changed)
    await db
      .prepare(
        `INSERT INTO osm_route_cache (cache_key, routes_json, fetched_at, failed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (cache_key) DO UPDATE SET routes_json = excluded.routes_json,
          fetched_at = excluded.fetched_at, failed_at = excluded.failed_at`,
      )
      .bind(key, stored ? JSON.stringify(stored) : null, fetchedAt, failedAt)
      .run();

  if (!stored) return { status: 'unavailable', routes: [] };
  const routes = nearest.flatMap(({ candidate, distance }) => {
    const outline = stored!.outlines[candidate.id];
    return outline
      ? [
          {
            id: `osm:relation/${candidate.id}`,
            name: candidate.name,
            kind: candidate.kind,
            lengthKm: outline.lengthKm,
            distanceKm: Math.round(distance * 10) / 10,
            segments: outline.segments,
            url: `https://www.openstreetmap.org/relation/${candidate.id}`,
          },
        ]
      : [];
  });
  // Nearby routes exist but none of their outlines could be fetched.
  if (nearest.length && !routes.length) return { status: 'unavailable', routes: [] };
  return { status: 'ok', ...(stale ? { stale: true } : {}), routes };
}

/** Drop areas whose last lookup, successful or not, was months ago. */
export async function pruneMappedRoutes(db: D1Database, now = Date.now()): Promise<void> {
  const cutoff = new Date(now - PRUNE_AFTER_MS).toISOString();
  await db
    .prepare(
      `DELETE FROM osm_route_cache
      WHERE max(COALESCE(fetched_at, ''), COALESCE(failed_at, '')) < ?`,
    )
    .bind(cutoff)
    .run();
}
