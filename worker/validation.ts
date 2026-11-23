import { SPORTS, type Sport, type Visibility } from '../src/app/models';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new HttpError(400, `${label} must be ${required ? '1' : '0'}–${max} characters.`);
  }
  return value.trim();
}

export function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
  }
  return value;
}

export function sport(value: unknown): Sport {
  if (!SPORTS.includes(value as Sport)) throw new HttpError(400, 'Choose a supported sport.');
  return value as Sport;
}

export function visibility(value: unknown): Visibility {
  if (value !== 'public' && value !== 'private')
    throw new HttpError(400, 'Choose public or private visibility.');
  return value;
}

export function date(value: unknown, future: boolean): string {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) throw new HttpError(400, 'Enter a valid date.');
  if (future && parsed <= Date.now()) throw new HttpError(400, 'Events must start in the future.');
  if (!future && parsed > Date.now() + 60_000)
    throw new HttpError(400, 'Activities cannot be in the future.');
  return new Date(parsed).toISOString();
}

export type RouteSegments = [number, number][][];
export const MAX_ROUTE_POINTS = 500;
const MAX_ROUTE_SEGMENTS = 50;

/** Validate an uploaded route and round its coordinates to about a metre. */
export function routeSegments(value: unknown): RouteSegments {
  const invalid = () =>
    new HttpError(
      400,
      `Route must be 1–${MAX_ROUTE_SEGMENTS} segments of 2 or more [latitude, longitude] points, at most ${MAX_ROUTE_POINTS} points in total.`,
    );
  if (!Array.isArray(value) || !value.length || value.length > MAX_ROUTE_SEGMENTS) throw invalid();
  let total = 0;
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return value.map((segment) => {
    if (!Array.isArray(segment) || segment.length < 2) throw invalid();
    total += segment.length;
    if (total > MAX_ROUTE_POINTS) throw invalid();
    return segment.map((point) => {
      if (!Array.isArray(point) || point.length !== 2) throw invalid();
      const [lat, lng] = point as unknown[];
      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      )
        throw invalid();
      return [round(lat), round(lng)] as [number, number];
    });
  });
}
