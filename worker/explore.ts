import { HttpError, type RouteSegments } from './validation';

export const EXPLORE_RADII = [5, 10, 25, 50, 100] as const;
const DEFAULT_RADIUS_KM = 25;

export interface ExploreOrigin {
  lat: number;
  lng: number;
}

/** Round coordinates to about 1 km so searches never handle a precise position. */
export const coarse = (value: number) => Math.round(value * 100) / 100;

/** Centre of a route's bounding box, rounded to about 100 m. */
export function routeCenter(segments: RouteSegments): ExploreOrigin {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const segment of segments)
    for (const [lat, lng] of segment) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { lat: round((minLat + maxLat) / 2), lng: round((minLng + maxLng) / 2) };
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: ExploreOrigin, b: ExploreOrigin): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  /** One longitude interval, or two when the box crosses the antimeridian. */
  lngRanges: [number, number][];
}

/** Latitude/longitude box that contains every point within `radiusKm` of `origin`. */
export function boundingBox(origin: ExploreOrigin, radiusKm: number): BoundingBox {
  const dLat = radiusKm / 111.32;
  const minLat = Math.max(-90, origin.lat - dLat);
  const maxLat = Math.min(90, origin.lat + dLat);
  // Near a pole, or when the radius spans a whole latitude circle, every longitude is in range.
  const cos = Math.cos((Math.max(Math.abs(minLat), Math.abs(maxLat)) * Math.PI) / 180);
  const dLng = cos < 0.01 ? 180 : radiusKm / (111.32 * cos);
  if (dLng >= 180) return { minLat, maxLat, lngRanges: [[-180, 180]] };
  const west = origin.lng - dLng;
  const east = origin.lng + dLng;
  if (west < -180)
    return {
      minLat,
      maxLat,
      lngRanges: [
        [west + 360, 180],
        [-180, east],
      ],
    };
  if (east > 180)
    return {
      minLat,
      maxLat,
      lngRanges: [
        [west, 180],
        [-180, east - 360],
      ],
    };
  return { minLat, maxLat, lngRanges: [[west, east]] };
}

/** Read an optional coordinate pair from the query string. */
export function queryOrigin(params: URLSearchParams): ExploreOrigin | null {
  const rawLat = params.get('lat');
  const rawLng = params.get('lng');
  if (rawLat === null && rawLng === null) return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (
    rawLat === null ||
    rawLng === null ||
    rawLat.trim() === '' ||
    rawLng.trim() === '' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    throw new HttpError(400, 'Location must be a latitude and longitude.');
  return { lat: coarse(lat), lng: coarse(lng) };
}

/** Approximate location from Cloudflare's IP geolocation, when the request carries one. */
export function networkOrigin(request: Request): (ExploreOrigin & { label: string | null }) | null {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  const lat = Number(cf?.['latitude']);
  const lng = Number(cf?.['longitude']);
  if (!cf || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0))
    return null;
  const city = typeof cf['city'] === 'string' ? cf['city'] : '';
  const country = typeof cf['country'] === 'string' ? cf['country'] : '';
  return {
    lat: coarse(lat),
    lng: coarse(lng),
    label: [city, country].filter(Boolean).join(', ') || null,
  };
}

export function queryRadius(params: URLSearchParams): number {
  const raw = params.get('radius');
  if (raw === null || raw === '') return DEFAULT_RADIUS_KM;
  const radius = Number(raw);
  if (!(EXPLORE_RADII as readonly number[]).includes(radius))
    throw new HttpError(400, `Radius must be one of ${EXPLORE_RADII.join(', ')} km.`);
  return radius;
}

/** A short, plain search term for place names, titles and descriptions. */
export function queryText(params: URLSearchParams): string {
  const value = (params.get('q') ?? '').trim().replace(/\s+/g, ' ');
  if (value.length > 80) throw new HttpError(400, 'Search must be 80 characters or fewer.');
  return value;
}

/** Escape LIKE wildcards so a search term matches literally. */
export const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
