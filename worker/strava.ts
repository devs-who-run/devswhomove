import type { Sport } from '../src/app/models';
import { importActivities, importSummary, type ImportResult } from './imports';
import { HttpError } from './validation';

export interface StravaEnv {
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  /** Base64-encoded random 32-byte AES key for refresh tokens at rest. */
  STRAVA_TOKEN_KEY?: string;
  /** Shared secret Strava echoes back when the webhook subscription is created. */
  STRAVA_WEBHOOK_VERIFY_TOKEN?: string;
  /** Local development only: point OAuth and API calls at a mock Strava server. */
  STRAVA_API_ORIGIN?: string;
}

interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
}

export interface StravaActivity {
  id: number;
  name?: string;
  sport_type?: string;
  type?: string;
  start_date?: string;
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
}

interface ConnectionRow {
  user_id: string;
  athlete_id: number;
  encrypted_tokens: string;
  scope: string;
  newest_cursor: number;
  oldest_cursor: number;
  history_complete: number;
  last_synced_at: string | null;
}

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athleteId?: number;
  historyComplete?: boolean;
  lastSyncedAt?: string | null;
}

const stravaOrigin = (env: StravaEnv) => env.STRAVA_API_ORIGIN || 'https://www.strava.com';
const PAGE_SIZE = 200;
/** Re-read a few days before the newest cursor so late uploads are not skipped. */
const NEWEST_OVERLAP_SECONDS = 3 * 86400;
export const STRAVA_SCOPE = 'activity:read_all';

export const stravaConfigured = (env: StravaEnv) =>
  Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET && env.STRAVA_TOKEN_KEY);

/** Map Strava's sport_type (or legacy type) onto the sports this app tracks. */
export function stravaSport(activity: Pick<StravaActivity, 'sport_type' | 'type'>): Sport {
  const type = activity.sport_type || activity.type || '';
  if (/Run$/.test(type) || type === 'Run') return 'Running';
  if (/Ride$/.test(type) || type === 'Handcycle' || type === 'Velomobile') return 'Cycling';
  if (type === 'Walk' || type === 'Hike') return 'Walking';
  if (type === 'Swim') return 'Swimming';
  if (type === 'Tennis') return 'Tennis';
  if (type === 'WeightTraining' || type === 'Crossfit') return 'Strength';
  return 'Other';
}

/** Convert a Strava activity summary into an import item without GPS, notes or device data. */
export function stravaImportItem(activity: StravaActivity) {
  const sport = stravaSport(activity);
  const seconds = activity.moving_time || activity.elapsed_time || 0;
  return {
    externalId: String(activity.id),
    title: (activity.name?.trim() || `${sport} from Strava`).slice(0, 100),
    sport,
    occurredAt: activity.start_date,
    duration: Math.round((seconds / 60) * 100) / 100,
    distance:
      typeof activity.distance === 'number' && activity.distance > 0
        ? Math.round(activity.distance) / 1000
        : null,
  };
}

function decodeKey(env: StravaEnv): Uint8Array {
  if (!env.STRAVA_TOKEN_KEY) throw new HttpError(503, 'Strava import is not configured.');
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(env.STRAVA_TOKEN_KEY), (char) => char.charCodeAt(0));
  } catch {
    throw new HttpError(503, 'STRAVA_TOKEN_KEY is not valid base64.');
  }
  if (raw.byteLength !== 32) throw new HttpError(503, 'STRAVA_TOKEN_KEY must decode to 32 bytes.');
  return raw;
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unbase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function encryptTokens(env: StravaEnv, tokens: StravaTokens, userId: string) {
  const key = await crypto.subtle.importKey('raw', decodeKey(env), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`strava:${userId}`) },
    key,
    new TextEncoder().encode(JSON.stringify(tokens)),
  );
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}

async function decryptTokens(env: StravaEnv, value: string, userId: string) {
  const [iv, ciphertext] = value.split('.');
  if (!iv || !ciphertext) throw new Error('Invalid encrypted Strava tokens.');
  const key = await crypto.subtle.importKey('raw', decodeKey(env), 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: unbase64(iv),
      additionalData: new TextEncoder().encode(`strava:${userId}`),
    },
    key,
    unbase64(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as StravaTokens;
}

/** Build the Strava consent URL. */
export function stravaAuthorizeUrl(env: StravaEnv, redirectUri: string, state: string): string {
  const url = new URL('/oauth/authorize', stravaOrigin(env));
  url.search = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(env: StravaEnv, params: Record<string, string>) {
  const response = await fetch(`${stravaOrigin(env)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID ?? '',
      client_secret: env.STRAVA_CLIENT_SECRET ?? '',
      ...params,
    }),
  });
  const data = await response.json<{
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    athlete?: { id?: number };
  }>();
  if (!response.ok || !data.access_token || !data.refresh_token || !data.expires_at) return null;
  return {
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    },
    athleteId: data.athlete?.id,
  };
}

/** Exchange an authorization code and store the connection for this GitHub account. */
export async function connectStrava(
  env: StravaEnv,
  db: D1Database,
  userId: string,
  code: string,
  grantedScope: string,
): Promise<void> {
  if (!grantedScope.split(',').includes(STRAVA_SCOPE))
    throw new HttpError(
      400,
      'Strava did not grant access to your activities. Allow “View data about your activities” and try again.',
    );
  const result = await tokenRequest(env, { code, grant_type: 'authorization_code' });
  if (!result || !Number.isSafeInteger(result.athleteId))
    throw new HttpError(502, 'Strava could not complete the connection. Please try again.');
  const owner = await db
    .prepare('SELECT user_id FROM strava_connections WHERE athlete_id = ?')
    .bind(result.athleteId)
    .first<{ user_id: string }>();
  if (owner && owner.user_id !== userId)
    throw new HttpError(409, 'This Strava account is already connected to another profile.');
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO strava_connections
      (user_id, athlete_id, encrypted_tokens, scope, newest_cursor, oldest_cursor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET athlete_id = excluded.athlete_id,
        encrypted_tokens = excluded.encrypted_tokens, scope = excluded.scope,
        newest_cursor = CASE WHEN strava_connections.athlete_id = excluded.athlete_id
          THEN strava_connections.newest_cursor ELSE excluded.newest_cursor END,
        oldest_cursor = CASE WHEN strava_connections.athlete_id = excluded.athlete_id
          THEN strava_connections.oldest_cursor ELSE excluded.oldest_cursor END,
        history_complete = CASE WHEN strava_connections.athlete_id = excluded.athlete_id
          THEN strava_connections.history_complete ELSE 0 END`,
    )
    .bind(
      userId,
      result.athleteId,
      await encryptTokens(env, result.tokens, userId),
      grantedScope,
      now,
      now,
      new Date().toISOString(),
    )
    .run();
}

async function connection(db: D1Database, userId: string) {
  return db
    .prepare('SELECT * FROM strava_connections WHERE user_id = ?')
    .bind(userId)
    .first<ConnectionRow>();
}

/** Return a usable access token, refreshing and persisting it when it is about to expire. */
async function accessToken(env: StravaEnv, db: D1Database, row: ConnectionRow): Promise<string> {
  const tokens = await decryptTokens(env, row.encrypted_tokens, row.user_id);
  if (tokens.expiresAt - 120 > Date.now() / 1000) return tokens.accessToken;
  const refreshed = await tokenRequest(env, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  });
  if (!refreshed) {
    await db.prepare('DELETE FROM strava_connections WHERE user_id = ?').bind(row.user_id).run();
    throw new HttpError(409, 'Strava access was revoked. Connect Strava again to keep importing.');
  }
  await db
    .prepare('UPDATE strava_connections SET encrypted_tokens = ? WHERE user_id = ?')
    .bind(await encryptTokens(env, refreshed.tokens, row.user_id), row.user_id)
    .run();
  return refreshed.tokens.accessToken;
}

async function stravaGet<T>(env: StravaEnv, token: string, path: string): Promise<T | null> {
  const response = await fetch(`${stravaOrigin(env)}/api/v3${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (response.status === 429)
    throw new HttpError(503, 'Strava’s rate limit was reached. Try again in about 15 minutes.', {
      'Retry-After': '900',
    });
  if (response.status === 401)
    throw new HttpError(409, 'Strava access was revoked. Connect Strava again to keep importing.');
  if (!response.ok) throw new HttpError(502, 'Strava could not be reached. Please try again.');
  return response.json<T>();
}

export async function stravaStatus(
  env: StravaEnv,
  db: D1Database,
  userId: string,
): Promise<StravaStatus> {
  if (!stravaConfigured(env)) return { configured: false, connected: false };
  const row = await connection(db, userId);
  return row
    ? {
        configured: true,
        connected: true,
        athleteId: row.athlete_id,
        historyComplete: row.history_complete === 1,
        lastSyncedAt: row.last_synced_at,
      }
    : { configured: true, connected: false };
}

/**
 * Import new Strava activities, then continue backfilling history.
 *
 * Each call reads at most `pageBudget` pages of 200 so a request stays well inside Worker and
 * Strava rate limits; the client calls again until `historyComplete` is true.
 */
export async function syncStrava(env: StravaEnv, db: D1Database, userId: string, pageBudget = 3) {
  const row = await connection(db, userId);
  if (!row) throw new HttpError(404, 'Connect Strava first.');
  const token = await accessToken(env, db, row);
  const results: ImportResult[] = [];
  let pages = 0;
  let newest = row.newest_cursor;
  let oldest = row.oldest_cursor;
  let historyComplete = row.history_complete === 1;
  const importPage = async (activities: StravaActivity[]) => {
    const page = await importActivities(db, userId, 'strava', activities.map(stravaImportItem));
    results.push(...page);
    for (const activity of activities) {
      const start = Math.floor(Date.parse(activity.start_date ?? '') / 1000);
      if (!Number.isFinite(start)) continue;
      newest = Math.max(newest, start);
      oldest = Math.min(oldest, start);
    }
  };

  const after = row.newest_cursor - NEWEST_OVERLAP_SECONDS;
  for (let page = 1; pages < pageBudget; page++) {
    pages++;
    const activities =
      (await stravaGet<StravaActivity[]>(
        env,
        token,
        `/athlete/activities?after=${after}&per_page=${PAGE_SIZE}&page=${page}`,
      )) ?? [];
    await importPage(activities);
    if (activities.length < PAGE_SIZE) break;
  }
  while (!historyComplete && pages < pageBudget) {
    pages++;
    const activities =
      (await stravaGet<StravaActivity[]>(
        env,
        token,
        `/athlete/activities?before=${oldest}&per_page=${PAGE_SIZE}&page=1`,
      )) ?? [];
    const before = oldest;
    await importPage(activities);
    if (activities.length < PAGE_SIZE || oldest >= before) historyComplete = true;
  }
  const lastSyncedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE strava_connections SET newest_cursor = ?, oldest_cursor = ?, history_complete = ?,
      last_synced_at = ? WHERE user_id = ?`,
    )
    .bind(newest, oldest, historyComplete ? 1 : 0, lastSyncedAt, userId)
    .run();
  return { ...importSummary(results), historyComplete, lastSyncedAt };
}

/** Revoke this app's Strava access (best effort) and forget the connection. */
export async function disconnectStrava(env: StravaEnv, db: D1Database, userId: string) {
  const row = await connection(db, userId);
  if (!row) return;
  try {
    const tokens = await decryptTokens(env, row.encrypted_tokens, userId);
    await fetch(`${stravaOrigin(env)}/oauth/deauthorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: tokens.accessToken }),
    });
  } catch (error) {
    console.error('Strava deauthorization failed; the local connection is removed anyway.', error);
  }
  await db.prepare('DELETE FROM strava_connections WHERE user_id = ?').bind(userId).run();
}

export interface StravaWebhookEvent {
  object_type?: string;
  object_id?: number;
  aspect_type?: string;
  owner_id?: number;
  updates?: Record<string, unknown>;
}

/** The connected user for a webhook event, if this app still holds a connection for the athlete. */
export async function webhookOwner(db: D1Database, event: StravaWebhookEvent) {
  if (!Number.isSafeInteger(event.owner_id)) return null;
  const row = await db
    .prepare('SELECT user_id FROM strava_connections WHERE athlete_id = ?')
    .bind(event.owner_id)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/**
 * Apply a Strava webhook event. Webhooks are unsigned, so an event is only a hint: new activities
 * are re-read from Strava with the athlete's own token, deletions only affect Strava imports, and
 * deauthorization is the athlete revoking access to this app.
 */
export async function applyStravaWebhook(
  env: StravaEnv,
  db: D1Database,
  userId: string,
  event: StravaWebhookEvent,
  deleteActivity: (activityId: string) => Promise<void>,
): Promise<void> {
  if (event.object_type === 'athlete') {
    if (event.updates?.['authorized'] === 'false')
      await db.prepare('DELETE FROM strava_connections WHERE user_id = ?').bind(userId).run();
    return;
  }
  if (event.object_type !== 'activity' || !Number.isSafeInteger(event.object_id)) return;
  if (event.aspect_type === 'delete') {
    const imported = await db
      .prepare(
        `SELECT id FROM activities WHERE user_id = ? AND import_source = 'strava' AND external_id = ?`,
      )
      .bind(userId, String(event.object_id))
      .first<{ id: string }>();
    if (imported) await deleteActivity(imported.id);
    return;
  }
  if (event.aspect_type !== 'create') return;
  const row = await connection(db, userId);
  if (!row) return;
  const activity = await stravaGet<StravaActivity>(
    env,
    await accessToken(env, db, row),
    `/activities/${event.object_id}`,
  );
  if (activity) await importActivities(db, userId, 'strava', [stravaImportItem(activity)]);
}
