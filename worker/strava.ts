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
  created_at: string;
  encrypted_tokens: string;
  scope: string;
  newest_cursor: number;
  oldest_cursor: number;
  history_complete: number;
  last_synced_at: string | null;
  refresh_cursor: number | null;
  refreshed_at: string | null;
  refresh_retry_at: string | null;
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
/** Strava data is kept only while re-confirmed from Strava within this window. */
export const STRAVA_RETENTION_MS = 7 * 86400_000;
/**
 * Rows become eligible for the purge half a day before the retention deadline, so a backlog has
 * 48 cron runs to drain before any row outlives seven days.
 */
const PURGE_AFTER_MS = STRAVA_RETENTION_MS - 12 * 3600_000;
/** Start a new re-fetch pass this long after the last one finished, leaving slack before purge. */
const REFRESH_INTERVAL_MS = 4 * 86400_000;
/** A failed re-fetch is retried after this delay, so it cannot crowd out healthy connections. */
const REFRESH_RETRY_MS = 60 * 60_000;

const REVOKED_MESSAGE = 'Strava access was revoked. Connect Strava again to keep importing.';

/** Strava rejected this athlete's token: access is gone, not temporarily unavailable. */
class StravaRevokedError extends HttpError {
  constructor() {
    super(409, REVOKED_MESSAGE);
  }
}

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
  const data = await response
    .json<{
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      athlete?: { id?: number };
      message?: string;
    }>()
    .catch(() => ({}) as Record<string, undefined>);
  if (!response.ok || !data.access_token || !data.refresh_token || !data.expires_at) {
    console.error('Strava token request failed', response.status, data.message ?? '');
    // 400/401 mean Strava rejected the code or refresh token; anything else may be temporary.
    return { ok: false as const, permanent: response.status === 400 || response.status === 401 };
  }
  return {
    ok: true as const,
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
  if (!result.ok || !Number.isSafeInteger(result.athleteId))
    throw new HttpError(502, 'Strava could not complete the connection. Please try again.');
  const owner = await db
    .prepare('SELECT user_id FROM strava_connections WHERE athlete_id = ?')
    .bind(result.athleteId)
    .first<{ user_id: string }>();
  if (owner && owner.user_id !== userId)
    throw new HttpError(409, 'This Strava account is already connected to another profile.');
  const previous = await connection(db, userId);
  // Switching athletes: the new connection and the removal of the previous athlete's imports
  // commit in one transaction. The previous generation's in-flight writes are fenced on its
  // athlete_id, so they fail after the switch, and anything they wrote before it is removed here.
  const switching = previous && previous.athlete_id !== result.athleteId;
  const cleanup = switching ? userStravaCleanup(db, userId) : [];
  const now = Math.floor(Date.now() / 1000);
  const upsert = db
    .prepare(
      `INSERT INTO strava_connections
      (user_id, athlete_id, encrypted_tokens, scope, newest_cursor, oldest_cursor, created_at,
        refreshed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET athlete_id = excluded.athlete_id,
        encrypted_tokens = excluded.encrypted_tokens, scope = excluded.scope,
        newest_cursor = CASE WHEN strava_connections.athlete_id = excluded.athlete_id
          THEN strava_connections.newest_cursor ELSE excluded.newest_cursor END,
        oldest_cursor = CASE WHEN strava_connections.athlete_id = excluded.athlete_id
          THEN strava_connections.oldest_cursor ELSE excluded.oldest_cursor END,
        history_complete = CASE WHEN strava_connections.athlete_id = excluded.athlete_id
          THEN strava_connections.history_complete ELSE 0 END,
        refresh_cursor = CASE WHEN strava_connections.athlete_id = excluded.athlete_id
          THEN strava_connections.refresh_cursor ELSE NULL END,
        refreshed_at = CASE WHEN strava_connections.athlete_id = excluded.athlete_id
          THEN strava_connections.refreshed_at ELSE excluded.refreshed_at END`,
    )
    .bind(
      userId,
      result.athleteId,
      await encryptTokens(env, result.tokens, userId),
      grantedScope,
      now,
      now,
      new Date().toISOString(),
      // The first sync fetches everything fresh, so the first re-fetch pass can wait.
      new Date().toISOString(),
    );
  await db.batch([...cleanup, upsert]);
}

/** Statements removing all of a user's Strava imports, social data and tombstones. */
function userStravaCleanup(db: D1Database, userId: string): D1PreparedStatement[] {
  const rows = `SELECT id FROM activities WHERE user_id = ? AND import_source = 'strava'`;
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO photo_deletions (key, queued_at, actor_id)
        SELECT photo_key, ?, 'github:' || user_id FROM activities
        WHERE user_id = ? AND import_source = 'strava' AND photo_key IS NOT NULL`,
      )
      .bind(new Date().toISOString(), userId),
    db.prepare(`DELETE FROM activity_kudos WHERE activity_id IN (${rows})`).bind(userId),
    db.prepare(`DELETE FROM activity_comments WHERE activity_id IN (${rows})`).bind(userId),
    db
      .prepare(`DELETE FROM activities WHERE user_id = ? AND import_source = 'strava'`)
      .bind(userId),
    db.prepare('DELETE FROM strava_deleted_activities WHERE user_id = ?').bind(userId),
  ];
}

/**
 * Delete Strava-imported activities with their kudos and comments, queueing photos for removal.
 *
 * - `userId`: one user's imports. With `unconnected`, only while that user has no Strava
 *   connection, so a reconnect that happens mid-cleanup keeps the new connection's data.
 * - `staleBefore`: the retention purge, for rows Strava has not re-confirmed since then.
 *
 * Every statement re-checks its condition inside the batch's transaction, so a row re-confirmed
 * (or reconnected) after it was selected keeps its activity, social data and photo. At most
 * `maxChunks` chunks of 200 are processed. Returns the number of activities removed.
 */
export async function deleteStravaImports(
  db: D1Database,
  filter: { userId: string; unconnected?: boolean } | { staleBefore: string },
  maxChunks = 500,
): Promise<number> {
  const condition =
    'userId' in filter
      ? {
          sql: `user_id = ? AND import_source = 'strava'${
            filter.unconnected
              ? ' AND NOT EXISTS (SELECT 1 FROM strava_connections WHERE user_id = ?)'
              : ''
          }`,
          binds: filter.unconnected ? [filter.userId, filter.userId] : [filter.userId],
        }
      : {
          sql: `import_source = 'strava' AND (fetched_at IS NULL OR fetched_at < ?)`,
          binds: [filter.staleBefore],
        };
  let removed = 0;
  for (let chunk = 0; chunk < maxChunks; chunk++) {
    const rows = await db
      .prepare(`SELECT id FROM activities WHERE ${condition.sql} LIMIT 200`)
      .bind(...condition.binds)
      .all<{ id: string }>();
    if (!rows.results.length) break;
    const ids = JSON.stringify(rows.results.map((row) => row.id));
    const still = `id IN (SELECT value FROM json_each(?)) AND ${condition.sql}`;
    const [, , , deleted] = await db.batch([
      // Photos are queued in the same transaction as the delete so they survive R2 failures.
      db
        .prepare(
          `INSERT OR IGNORE INTO photo_deletions (key, queued_at, actor_id)
          SELECT photo_key, ?, 'github:' || user_id FROM activities
          WHERE ${still} AND photo_key IS NOT NULL`,
        )
        .bind(new Date().toISOString(), ids, ...condition.binds),
      db
        .prepare(
          `DELETE FROM activity_kudos WHERE activity_id IN (SELECT id FROM activities WHERE ${still})`,
        )
        .bind(ids, ...condition.binds),
      db
        .prepare(
          `DELETE FROM activity_comments WHERE activity_id IN (SELECT id FROM activities WHERE ${still})`,
        )
        .bind(ids, ...condition.binds),
      db.prepare(`DELETE FROM activities WHERE ${still}`).bind(ids, ...condition.binds),
    ]);
    // Rows that stopped matching between the read and the write (re-confirmed, or reconnected)
    // are kept, and the next selection no longer returns them; an empty selection ends the scan.
    removed += deleted?.meta.changes ?? 0;
  }
  return removed;
}

/**
 * Remove a connection and every activity imported through it. The connection row goes first,
 * fenced to this generation, so in-flight syncs and webhooks can no longer write; imports are
 * then deleted only while the user has no connection, so a replacement keeps its own data.
 */
async function forgetStrava(db: D1Database, row: ConnectionRow): Promise<number> {
  await db
    .prepare(
      'DELETE FROM strava_connections WHERE user_id = ? AND athlete_id = ? AND created_at = ?',
    )
    .bind(row.user_id, row.athlete_id, row.created_at)
    .run();
  await db
    .prepare(
      `DELETE FROM strava_deleted_activities WHERE user_id = ?
      AND NOT EXISTS (SELECT 1 FROM strava_connections WHERE user_id = ?)`,
    )
    .bind(row.user_id, row.user_id)
    .run();
  return deleteStravaImports(db, { userId: row.user_id, unconnected: true });
}

/** The import options that fence writes to this connection generation. */
const fence = (row: ConnectionRow, observedAt: string) => ({
  observedAt,
  connection: { athleteId: row.athlete_id, createdAt: row.created_at },
});

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
  if (!refreshed.ok) {
    if (!refreshed.permanent)
      throw new HttpError(502, 'Strava could not refresh access right now. Please try again.');
    await forgetStrava(db, row);
    throw new StravaRevokedError();
  }
  await db
    .prepare(
      `UPDATE strava_connections SET encrypted_tokens = ?
      WHERE user_id = ? AND athlete_id = ? AND created_at = ?`,
    )
    .bind(
      await encryptTokens(env, refreshed.tokens, row.user_id),
      row.user_id,
      row.athlete_id,
      row.created_at,
    )
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
  if (response.status === 401) throw new StravaRevokedError();
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
  try {
    return await syncConnection(env, db, row, pageBudget);
  } catch (error) {
    if (error instanceof StravaRevokedError) await forgetStrava(db, row);
    throw error;
  }
}

async function syncConnection(
  env: StravaEnv,
  db: D1Database,
  row: ConnectionRow,
  pageBudget: number,
) {
  const userId = row.user_id;
  const token = await accessToken(env, db, row);
  const results: ImportResult[] = [];
  let pages = 0;
  let newest = row.newest_cursor;
  let oldest = row.oldest_cursor;
  let historyComplete = row.history_complete === 1;
  const importPage = async (activities: StravaActivity[], observedAt: string) => {
    const page = await importActivities(
      db,
      userId,
      'strava',
      activities.map(stravaImportItem),
      fence(row, observedAt),
    );
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
    await importPage(activities, new Date().toISOString());
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
    await importPage(activities, new Date().toISOString());
    if (!activities.length) historyComplete = true;
    // Undated activities cannot move the cursor; step past them so the next page makes progress.
    else if (oldest >= before) oldest = before - 1;
  }
  const lastSyncedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE strava_connections SET newest_cursor = ?, oldest_cursor = ?, history_complete = ?,
      last_synced_at = ? WHERE user_id = ? AND athlete_id = ? AND created_at = ?`,
    )
    .bind(
      newest,
      oldest,
      historyComplete ? 1 : 0,
      lastSyncedAt,
      userId,
      row.athlete_id,
      row.created_at,
    )
    .run();
  return { ...importSummary(results), historyComplete, lastSyncedAt };
}

/**
 * Revoke this app's Strava access (best effort), then delete the connection and every activity
 * imported from Strava. Returns the number of activities removed.
 */
export async function disconnectStrava(
  env: StravaEnv,
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await connection(db, userId);
  if (!row) {
    // No connection: remove anything left behind (e.g. by an interrupted cleanup).
    await db
      .prepare(
        `DELETE FROM strava_deleted_activities WHERE user_id = ?
        AND NOT EXISTS (SELECT 1 FROM strava_connections WHERE user_id = ?)`,
      )
      .bind(userId, userId)
      .run();
    return deleteStravaImports(db, { userId, unconnected: true });
  }
  try {
    const tokens = await decryptTokens(env, row.encrypted_tokens, userId);
    const response = await fetch(`${stravaOrigin(env)}/oauth/deauthorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: tokens.accessToken }),
    });
    if (!response.ok) console.error('Strava deauthorization was not confirmed', response.status);
  } catch (error) {
    console.error('Strava deauthorization failed; local Strava data is removed anyway.', error);
  }
  return forgetStrava(db, row);
}

/**
 * Advance this connection's rolling re-fetch of its whole Strava history by up to `pageBudget`
 * pages. Every activity Strava returns is re-confirmed (and updated); rows that are not
 * re-confirmed within the retention window are later purged, which also removes activities
 * deleted on Strava. A pass starts again `REFRESH_INTERVAL_MS` after the previous one finished.
 */
export async function refreshStravaHistory(
  env: StravaEnv,
  db: D1Database,
  userId: string,
  pageBudget = 2,
): Promise<void> {
  const row = await connection(db, userId);
  if (!row) return;
  try {
    const token = await accessToken(env, db, row);
    let cursor = row.refresh_cursor ?? Math.floor(Date.now() / 1000) + 86400;
    let finished = false;
    for (let pages = 0; pages < pageBudget && !finished; pages++) {
      const activities =
        (await stravaGet<StravaActivity[]>(
          env,
          token,
          `/athlete/activities?before=${cursor}&per_page=${PAGE_SIZE}&page=1`,
        )) ?? [];
      const observedAt = new Date().toISOString();
      if (!activities.length) {
        finished = true;
        break;
      }
      await importActivities(
        db,
        userId,
        'strava',
        activities.map(stravaImportItem),
        fence(row, observedAt),
      );
      const before = cursor;
      for (const activity of activities) {
        const start = Math.floor(Date.parse(activity.start_date ?? '') / 1000);
        if (Number.isFinite(start)) cursor = Math.min(cursor, start);
      }
      if (cursor >= before) cursor = before - 1;
    }
    await db
      .prepare(
        `UPDATE strava_connections SET refresh_cursor = ?, refresh_retry_at = NULL,
        refreshed_at = CASE WHEN ? THEN ? ELSE refreshed_at END
        WHERE user_id = ? AND athlete_id = ? AND created_at = ?`,
      )
      .bind(
        finished ? null : cursor,
        finished ? 1 : 0,
        new Date().toISOString(),
        userId,
        row.athlete_id,
        row.created_at,
      )
      .run();
  } catch (error) {
    if (error instanceof StravaRevokedError) await forgetStrava(db, row);
    else
      await db
        .prepare(
          `UPDATE strava_connections SET refresh_retry_at = ?
          WHERE user_id = ? AND athlete_id = ? AND created_at = ?`,
        )
        .bind(
          new Date(Date.now() + REFRESH_RETRY_MS).toISOString(),
          userId,
          row.athlete_id,
          row.created_at,
        )
        .run();
    throw error;
  }
}

/** Connections with a re-fetch pass in progress or due, oldest first. */
export async function stravaRefreshesDue(db: D1Database, limit: number): Promise<string[]> {
  const due = await db
    .prepare(
      `SELECT user_id FROM strava_connections
      WHERE (refresh_retry_at IS NULL OR refresh_retry_at <= ?)
      AND (refresh_cursor IS NOT NULL OR refreshed_at IS NULL OR refreshed_at < ?)
      ORDER BY COALESCE(refreshed_at, '') LIMIT ?`,
    )
    .bind(new Date().toISOString(), new Date(Date.now() - REFRESH_INTERVAL_MS).toISOString(), limit)
    .all<{ user_id: string }>();
  return due.results.map((row) => row.user_id);
}

/**
 * Delete Strava imports that Strava has not re-confirmed within the retention window. Rows are
 * purged from 6.5 days, half a day early, at most `maxChunks` chunks of 200 per call (two D1
 * queries per chunk); the next cron run continues where this one stopped.
 */
export function purgeExpiredStravaImports(db: D1Database, maxChunks: number): Promise<number> {
  return deleteStravaImports(
    db,
    { staleBefore: new Date(Date.now() - PURGE_AFTER_MS).toISOString() },
    maxChunks,
  );
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
 * Apply a Strava webhook event. Webhooks are unsigned, so an event is only a hint and is checked
 * against Strava with the athlete's own token: new activities are re-read, an activity is deleted
 * only once Strava no longer returns it, and a connection is dropped only once Strava rejects the
 * token. If Strava's state cannot be confirmed, the error propagates so the event is retried.
 */
export async function applyStravaWebhook(
  env: StravaEnv,
  db: D1Database,
  userId: string,
  event: StravaWebhookEvent,
  deleteActivity: (activityId: string) => Promise<void>,
): Promise<void> {
  const row = await connection(db, userId);
  if (!row || row.athlete_id !== event.owner_id) return;
  if (event.object_type === 'athlete') {
    if (event.updates?.['authorized'] !== 'false') return;
    try {
      await stravaGet(env, await accessToken(env, db, row), '/athlete');
      return; // Strava still accepts the token, so access was not revoked.
    } catch (error) {
      if (!(error instanceof StravaRevokedError)) throw error;
    }
    await forgetStrava(db, row);
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
    if (!imported) return;
    const stillThere = await stravaGet<StravaActivity>(
      env,
      await accessToken(env, db, row),
      `/activities/${event.object_id}`,
    );
    if (!stillThere) await deleteActivity(imported.id);
    return;
  }
  if (event.aspect_type !== 'create') return;
  const activity = await stravaGet<StravaActivity>(
    env,
    await accessToken(env, db, row),
    `/activities/${event.object_id}`,
  );
  if (activity)
    await importActivities(
      db,
      userId,
      'strava',
      [stravaImportItem(activity)],
      fence(row, new Date().toISOString()),
    );
}
