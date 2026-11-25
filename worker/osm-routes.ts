/**
 * Named walking, running and cycling routes mapped in OpenStreetMap, found with the Overpass API.
 * Only the Worker talks to Overpass, with a location rounded to a ~5 km grid, so OpenStreetMap
 * never sees a member's IP address or precise position. Results are cached for a week.
 */
import { distanceMeters, simplifyRoute, type RouteSegments } from '../src/app/route-geometry';
import type { MappedRoutesResult, Sport } from '../src/app/models';
import { distanceKm, type ExploreOrigin } from './explore';

/** Public Overpass instances, tried in order; the main one is often at capacity. */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const CACHE_SECONDS = 7 * 24 * 60 * 60;
const FAILURE_CACHE_SECONDS = 10 * 60;
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
  members?: { type: string; geometry?: { lat: number; lon: number }[] }[];
}

interface Candidate {
  id: number;
  name: string;
  kind: string;
  center: ExploreOrigin;
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
      if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
      return ((await response.json()) as { elements?: OverpassElement[] }).elements ?? [];
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

/** Find routes for one grid cell: first small tag and bounds results, then geometry for the nearest. */
async function lookup(
  cell: ExploreOrigin,
  radiusKm: number,
  group: Group,
  userAgent: string,
): Promise<(Candidate & { lengthKm: number; segments: RouteSegments })[]> {
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
  const nearest = candidates
    .sort((a, b) => distanceKm(cell, a.center) - distanceKm(cell, b.center))
    .slice(0, MAX_ROUTES);
  if (!nearest.length) return [];

  const detailed = await overpass(
    `[out:json][timeout:20];relation(id:${nearest.map((item) => item.id).join(',')});out geom qt;`,
    userAgent,
  );
  const byId = new Map(detailed.map((element) => [element.id, element]));
  return nearest.flatMap((candidate) => {
    const segments = joinWays(
      (byId.get(candidate.id)?.members ?? [])
        .filter((member) => member.type === 'way' && (member.geometry?.length ?? 0) >= 2)
        .map((member) => member.geometry!.map(({ lat, lon }) => [lat, lon] as [number, number])),
    );
    if (!segments.length) return [];
    let meters = 0;
    for (const segment of segments)
      for (let index = 1; index < segment.length; index++)
        meters += distanceMeters(
          { lat: segment[index - 1][0], lng: segment[index - 1][1] },
          { lat: segment[index][0], lng: segment[index][1] },
        );
    return [
      {
        ...candidate,
        lengthKm: Math.round(meters / 100) / 10,
        segments: simplifyRoute(segments, 300, 50),
      },
    ];
  });
}

/** Routes mapped in OpenStreetMap within `radiusKm` of `origin`, nearest first. */
export async function mappedRoutes(
  origin: ExploreOrigin,
  radiusKm: number,
  sport: Sport | null,
  appUrl: string,
): Promise<MappedRoutesResult> {
  const group = routeGroup(sport);
  if (!group) return { status: 'ok', routes: [] };
  const snap = (value: number) => Math.round(value / GRID_DEGREES) * GRID_DEGREES;
  const cell = {
    lat: Number(snap(origin.lat).toFixed(2)),
    lng: Number(snap(origin.lng).toFixed(2)),
  };
  const base = new URL(appUrl).origin;
  const cacheKey = new Request(
    `${base}/__osm-routes/v1/${group}/${radiusKm}/${cell.lat}/${cell.lng}.json`,
  );
  const cache = typeof caches === 'undefined' ? undefined : caches.default;

  // A cached null records a recent failure; undefined means nothing is cached.
  let found: Awaited<ReturnType<typeof lookup>> | null | undefined;
  const cached = await cache?.match(cacheKey);
  if (cached) found = await cached.json();
  if (found === undefined) {
    try {
      found = await lookup(cell, radiusKm, group, `DevsWhoMove/1.0 (+${base})`);
      await cache?.put(
        cacheKey,
        Response.json(found, { headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } }),
      );
    } catch (error) {
      console.warn('OpenStreetMap route lookup failed', error);
      // Remember the failure briefly so a struggling Overpass server is not retried on every view.
      await cache?.put(
        cacheKey,
        Response.json(null, {
          headers: { 'Cache-Control': `public, max-age=${FAILURE_CACHE_SECONDS}` },
        }),
      );
      return { status: 'unavailable', routes: [] };
    }
  }
  if (!Array.isArray(found)) return { status: 'unavailable', routes: [] };

  return {
    status: 'ok',
    routes: found
      .map(({ center, ...route }) => ({
        id: `osm:relation/${route.id}`,
        name: route.name,
        kind: route.kind,
        lengthKm: route.lengthKm,
        distanceKm: Math.round(distanceKm(origin, center) * 10) / 10,
        segments: route.segments,
        url: `https://www.openstreetmap.org/relation/${route.id}`,
      }))
      .filter((route) => route.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_ROUTES),
  };
}
