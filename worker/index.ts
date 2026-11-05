import {
  SPORTS,
  type Activity,
  type AgentScope,
  type Profile,
  type Sport,
  type SportEvent,
} from '../src/app/models';
import {
  ACTIVITY_COLLECTION,
  ATPROTO_OAUTH_SCOPE,
  atprotoAgent,
  atprotoProfileChanges,
  EVENT_COLLECTION,
  oauthClient,
  PROFILE_COLLECTION,
} from './atproto';
import {
  OAuthResponseError,
  TokenInvalidError,
  TokenRefreshError,
  TokenRevokedError,
} from '@atproto/oauth-client';
import type { Agent } from '@atproto/api';
import { MAX_PHOTO_BYTES, sanitizeImage } from './images';
import { handleMcp } from './mcp';
import { date, HttpError, number, sport, text, visibility } from './validation';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PHOTOS: R2Bucket;
  APP_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ATPROTO_OAUTH_PRIVATE_KEY?: string;
  ATPROTO_SESSION_KEY?: string;
}

interface UserRow extends Omit<Profile, 'sports'> {
  sports: string;
}
interface Identity {
  user: Profile;
  agent: boolean;
  scopes: AgentScope[];
  provider: 'github' | 'atproto';
  atprotoAgent?: Agent;
}
const ALL_SCOPES: AgentScope[] = ['activities:read', 'activities:write', 'events:read'];
const ATPROTO_SYNC_INTERVAL_MS = 5 * 60_000;
const ACTIVITY_SELECT = `SELECT a.id, a.user_id AS userId, u.username, u.name, u.avatar,
  a.title, a.sport, a.occurred_at AS occurredAt, a.duration, a.distance, a.notes,
  a.visibility, a.source,
  CASE WHEN a.photo_key IS NULL THEN NULL
    ELSE '/api/activities/' || a.id || '/photo?v=' || substr(a.photo_key, -12) END AS photo
  FROM activities a JOIN users u ON u.id = a.user_id`;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Hash opaque browser sessions and bearer tokens before storage or lookup. */
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Generate a cryptographically random opaque session or token. */
function secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Read one named cookie from a request without exposing unrelated cookie values. */
function cookie(request: Request, name: string): string | undefined {
  return request.headers
    .get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Decode one URL path segment and reject malformed percent-encoding. */
function decodedPathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'Invalid URL path.');
  }
}

/** Extract a record key only when the AT URI belongs to the expected DID and collection. */
function recordKey(uri: string, did: string, collection: string): string {
  const prefix = `at://${did}/${collection}/`;
  if (!uri.startsWith(prefix)) throw new HttpError(404, 'Record not found.');
  const key = uri.slice(prefix.length);
  if (!key || key.includes('/')) throw new HttpError(404, 'Record not found.');
  return key;
}

/** Check that a PDS record URI belongs to the expected repository and collection. */
function validRecordUri(uri: string, did: string, collection: string): boolean {
  const prefix = `at://${did}/${collection}/`;
  const rkey = uri.startsWith(prefix) ? uri.slice(prefix.length) : '';
  return Boolean(rkey) && !rkey.includes('/');
}

/** Normalize public PDS profile fields before storing them in the application projection. */
function atprotoProfile(
  handle: string,
  nativeProfile: unknown,
  appProfile: unknown,
): { name: string; bio: string; sports: Sport[] } {
  const native =
    nativeProfile && typeof nativeProfile === 'object' && !Array.isArray(nativeProfile)
      ? (nativeProfile as Record<string, unknown>)
      : {};
  const app =
    appProfile && typeof appProfile === 'object' && !Array.isArray(appProfile)
      ? (appProfile as Record<string, unknown>)
      : {};
  const name =
    typeof native['displayName'] === 'string' && native['displayName'].trim()
      ? native['displayName'].trim().slice(0, 80)
      : handle.slice(0, 80);
  const bio =
    typeof native['description'] === 'string' ? native['description'].trim().slice(0, 300) : '';
  const sports = Array.isArray(app['sports'])
    ? [
        ...new Set(
          app['sports'].flatMap((value): Sport[] => {
            const valid = SPORTS.find((item) => item === value);
            return valid ? [valid] : [];
          }),
        ),
      ].slice(0, 7)
    : [];
  return { name, bio, sports };
}

/** Create an HTTP-only session cookie with the configured origin's secure policy. */
function setCookie(env: Env, name: string, value: string, age: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(env.APP_URL).protocol === 'https:' ? '; Secure' : ''}`;
}

/** Parse a stored user row's JSON sports list into the API profile shape. */
function profile(row: UserRow): Profile {
  return { ...row, sports: JSON.parse(row.sports) };
}

/** Authenticate a request using a scoped bearer token or a browser session cookie. */
async function identity(request: Request, env: Env): Promise<Identity | null> {
  const authorization = request.headers.get('Authorization');
  // Any Authorization header (even empty) bypasses the Origin check, so it must never fall back to the session cookie.
  if (authorization !== null) {
    const match = /^Bearer (dwm_[a-f0-9]{64})$/.exec(authorization);
    if (!match) throw new HttpError(401, 'Invalid agent token.');
    const token = await env.DB.prepare(
      'SELECT user_id, scopes FROM agent_tokens WHERE token_hash = ? AND expires_at > ?',
    )
      .bind(await hash(match[1]), new Date().toISOString())
      .first<{ user_id: string; scopes: string }>();
    if (token) {
      const row = await env.DB.prepare(
        'SELECT id, username, name, avatar, bio, location, sports, visibility FROM users WHERE id = ?',
      )
        .bind(token.user_id)
        .first<UserRow>();
      if (!row) throw new HttpError(401, 'Account no longer exists.');
      return {
        user: profile(row),
        agent: true,
        scopes: JSON.parse(token.scopes),
        provider: 'github',
      };
    }
    const atprotoToken = await env.DB.prepare(
      'SELECT did, scopes FROM atproto_agent_tokens WHERE token_hash = ? AND expires_at > ?',
    )
      .bind(await hash(match[1]), new Date().toISOString())
      .first<{ did: string; scopes: string }>();
    if (!atprotoToken) throw new HttpError(401, 'Agent token expired or revoked.');
    const identity = await atprotoIdentity(
      env,
      atprotoToken.did,
      true,
      JSON.parse(atprotoToken.scopes),
    );
    if (!identity) throw new HttpError(401, 'AT Protocol authorization has expired.');
    return identity;
  }
  const session = cookie(request, 'dwm_session');
  if (!session) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.avatar, u.bio, u.location, u.sports, u.visibility
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hash(session), new Date().toISOString())
    .first<UserRow>();
  if (row) return { user: profile(row), agent: false, scopes: ALL_SCOPES, provider: 'github' };
  const atprotoSession = await env.DB.prepare(
    `SELECT did FROM atproto_sessions WHERE token_hash = ? AND expires_at > ?`,
  )
    .bind(await hash(session), new Date().toISOString())
    .first<{ did: string }>();
  return atprotoSession ? atprotoIdentity(env, atprotoSession.did, false, ALL_SCOPES) : null;
}

/** Restore an AT Protocol identity, treating removed OAuth sessions as expired authorization. */
async function atprotoIdentity(
  env: Env,
  did: string,
  agent: boolean,
  scopes: AgentScope[],
): Promise<Identity | null> {
  const row = await env.DB.prepare(
    `SELECT did AS id, handle AS username, name, avatar, bio, '' AS location,
      sports, 'public' AS visibility FROM atproto_accounts WHERE did = ?`,
  )
    .bind(did)
    .first<UserRow>();
  if (!row) throw new HttpError(401, 'AT Protocol account no longer exists.');
  const storedBefore = await env.DB.prepare(
    'SELECT 1 AS found FROM atproto_oauth_sessions WHERE did = ?',
  )
    .bind(did)
    .first();
  if (!storedBefore) {
    await env.DB.prepare('DELETE FROM atproto_sessions WHERE did = ?').bind(did).run();
    if (agent) throw new HttpError(401, 'AT Protocol authorization has expired.');
    return null;
  }
  let session;
  try {
    const client = await oauthClient(env);
    session = await client.restore(did);
  } catch (error) {
    const storedAfter = await env.DB.prepare(
      'SELECT 1 AS found FROM atproto_oauth_sessions WHERE did = ?',
    )
      .bind(did)
      .first();
    if (storedAfter)
      throw new HttpError(503, 'AT Protocol authorization is temporarily unavailable.');
    await env.DB.prepare('DELETE FROM atproto_sessions WHERE did = ?').bind(did).run();
    const oauthError = causeOfType(error, OAuthResponseError);
    const permanentlyRejected =
      (oauthError instanceof OAuthResponseError && oauthError.error === 'invalid_grant') ||
      error instanceof TokenRefreshError ||
      error instanceof TokenRevokedError ||
      error instanceof TokenInvalidError;
    if (!permanentlyRejected)
      throw new HttpError(503, 'AT Protocol authorization is temporarily unavailable.');
    if (agent) throw new HttpError(401, 'AT Protocol authorization has expired.');
    return null;
  }
  return {
    user: { ...profile(row), provider: 'atproto' },
    agent,
    scopes,
    provider: 'atproto',
    atprotoAgent: atprotoAgent(session),
  };
}

/** Find a typed error in a nested cause chain returned by the OAuth client. */
function causeOfType<T extends Error>(
  error: unknown,
  ErrorType: new (...args: never[]) => T,
): T | undefined {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof ErrorType) return current;
    current = current.cause;
  }
}

/** Enforce authentication, scope, and browser-only requirements for an endpoint. */
function requireIdentity(auth: Identity | null, scope?: AgentScope, browserOnly = false): Identity {
  if (!auth) throw new HttpError(401, 'Sign in to continue.');
  if (browserOnly && auth.agent)
    throw new HttpError(403, 'This action requires a browser session.');
  if (scope && !auth.scopes.includes(scope))
    throw new HttpError(403, `This token needs ${scope} permission.`);
  return auth;
}

/** Read a bounded request body and reject oversized payloads while streaming. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('Content-Length') || 0) > limit)
    throw new HttpError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new HttpError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Parse a JSON object request body and return a client error for invalid input. */
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    throw new HttpError(415, 'Use application/json.');
  }
  const bytes = await readLimited(request, 16_384);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new HttpError(400, 'Expected a JSON object.');
  return data as Record<string, unknown>;
}

/** Combine the public community feed with the signed-in GitHub user's own activities. */
async function activities(env: Env, userId?: string): Promise<Activity[]> {
  const [github, atproto] = await Promise.all([
    env.DB.prepare(
      `${ACTIVITY_SELECT}
    WHERE (a.user_id = ? OR (a.visibility = 'public' AND u.visibility = 'public'))
    ORDER BY a.occurred_at DESC LIMIT 100`,
    )
      .bind(userId || '')
      .all<Activity>(),
    env.DB.prepare(
      `SELECT a.uri AS id, a.did AS userId, u.handle AS username, u.name, u.avatar,
        json_extract(a.record_json, '$.title') AS title,
        json_extract(a.record_json, '$.sport') AS sport,
        json_extract(a.record_json, '$.occurredAt') AS occurredAt,
        json_extract(a.record_json, '$.duration') AS duration,
        json_extract(a.record_json, '$.distance') AS distance,
        json_extract(a.record_json, '$.notes') AS notes,
        'public' AS visibility, json_extract(a.record_json, '$.source') AS source,
        NULL AS photo
      FROM atproto_activities a JOIN atproto_accounts u ON u.did = a.did
      ORDER BY json_extract(a.record_json, '$.occurredAt') DESC LIMIT 100`,
    ).all<Activity>(),
  ]);
  return [...github.results, ...atproto.results]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 100);
}

/** Return the latest indexed activities owned by one AT Protocol DID. */
async function atprotoActivitiesByDid(env: Env, did: string): Promise<Activity[]> {
  const result = await env.DB.prepare(
    `SELECT a.uri AS id, a.did AS userId, u.handle AS username, u.name, u.avatar,
      json_extract(a.record_json, '$.title') AS title,
      json_extract(a.record_json, '$.sport') AS sport,
      json_extract(a.record_json, '$.occurredAt') AS occurredAt,
      json_extract(a.record_json, '$.duration') AS duration,
      json_extract(a.record_json, '$.distance') AS distance,
      json_extract(a.record_json, '$.notes') AS notes,
      'public' AS visibility, json_extract(a.record_json, '$.source') AS source,
      NULL AS photo
    FROM atproto_activities a JOIN atproto_accounts u ON u.did = a.did
    WHERE a.did = ? ORDER BY json_extract(a.record_json, '$.occurredAt') DESC LIMIT 100`,
  )
    .bind(did)
    .all<Activity>();
  return result.results;
}

/** Return activities visible on a GitHub profile or all public activities for a DID. */
async function profileActivities(
  env: Env,
  profileId: string,
  viewerId: string,
): Promise<Activity[]> {
  if (profileId.startsWith('did:')) return atprotoActivitiesByDid(env, profileId);
  const result = await env.DB.prepare(
    `${ACTIVITY_SELECT} WHERE a.user_id = ?
    AND (a.visibility = 'public' OR a.user_id = ?) ORDER BY a.occurred_at DESC LIMIT 100`,
  )
    .bind(profileId, viewerId)
    .all<Activity>();
  return result.results;
}

/** Combine upcoming GitHub and AT Protocol events without exposing attendee identities. */
async function events(env: Env, userId?: string): Promise<SportEvent[]> {
  const [github, atproto] = await Promise.all([
    env.DB.prepare(
      `SELECT e.id, e.host_id AS hostId, u.name AS hostName,
    e.title, e.sport, e.starts_at AS startsAt, e.location, e.description, e.level, e.capacity,
    (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id) +
    (SELECT COUNT(*) FROM atproto_external_event_attendees WHERE event_id = e.id) AS attendees,
    EXISTS(SELECT 1 FROM event_attendees WHERE event_id = e.id AND user_id = ?) OR
    EXISTS(SELECT 1 FROM atproto_external_event_attendees
      WHERE event_id = e.id AND attendee_id = ?) AS joined
    FROM events e JOIN users u ON u.id = e.host_id
    WHERE e.cancelled = 0 AND e.starts_at > ? ORDER BY e.starts_at LIMIT 100`,
    )
      .bind(
        userId || '',
        userId ? `${userId.startsWith('did:') ? 'atproto' : 'github'}:${userId}` : '',
        new Date().toISOString(),
      )
      .all<SportEvent>(),
    env.DB.prepare(
      `SELECT e.uri AS id, e.did AS hostId, u.name AS hostName, e.title, e.sport,
        e.starts_at AS startsAt, e.location, e.description, e.level, e.capacity,
        (SELECT COUNT(*) FROM atproto_event_attendees WHERE event_uri = e.uri) AS attendees,
        EXISTS(SELECT 1 FROM atproto_event_attendees
          WHERE event_uri = e.uri AND attendee_id = ?) AS joined
      FROM atproto_events e JOIN atproto_accounts u ON u.did = e.did
      WHERE e.starts_at > ? ORDER BY e.starts_at LIMIT 100`,
    )
      .bind(
        userId ? `${userId.startsWith('did:') ? 'atproto' : 'github'}:${userId}` : '',
        new Date().toISOString(),
      )
      .all<SportEvent>(),
  ]);
  return [...github.results, ...atproto.results]
    .map((event) => ({ ...event, joined: Boolean(event.joined) }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 100);
}

/** Build the public activity lexicon record for a validated application activity. */
function activityRecord(row: Record<string, unknown>, source: 'web' | 'agent') {
  return {
    $type: ACTIVITY_COLLECTION,
    title: row['title'],
    sport: row['sport'],
    occurredAt: row['occurredAt'],
    duration: row['duration'],
    ...(row['distance'] == null ? {} : { distance: row['distance'] }),
    notes: row['notes'],
    source,
  };
}

/** Build the public event lexicon record from validated event fields. */
function eventRecord(fields: readonly [string, string, string, string, string, string, number]) {
  const [title, eventSport, startsAt, location, description, level, capacity] = fields;
  return {
    $type: EVENT_COLLECTION,
    title,
    sport: eventSport,
    startsAt,
    location,
    description,
    level,
    capacity,
  };
}

/** Publish a validated public activity to the user's PDS and index it in D1. */
async function saveAtprotoActivity(
  env: Env,
  actor: Identity,
  input: Record<string, unknown>,
): Promise<string> {
  const { user, atprotoAgent: agent } = actor;
  if (!agent) throw new HttpError(500, 'AT Protocol session is unavailable.');
  const entry = {
    title: text(input['title'], 'Title', 100),
    sport: sport(input['sport']),
    occurredAt: date(input['occurredAt'], false),
    duration: number(input['duration'], 'Duration in minutes', 1, 1440),
    distance:
      input['distance'] == null ? null : number(input['distance'], 'Distance in km', 0, 2000),
    notes: text(input['notes'] ?? '', 'Notes', 2000, false),
  };
  const record = activityRecord(entry, actor.agent ? 'agent' : 'web');
  const created = await agent.com.atproto.repo.createRecord({
    repo: user.id,
    collection: ACTIVITY_COLLECTION,
    record,
  });
  await env.DB.prepare(
    `INSERT INTO atproto_activities (uri, did, rkey, record_json, indexed_at)
    VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      created.data.uri,
      user.id,
      created.data.uri.split('/').at(-1),
      JSON.stringify(record),
      new Date().toISOString(),
    )
    .run();
  return created.data.uri;
}

/** Publish a hosted event to the host's PDS and index it for community discovery. */
async function saveAtprotoEvent(
  env: Env,
  actor: Identity,
  fields: ReturnType<typeof eventFields>,
): Promise<string> {
  const agent = actor.atprotoAgent;
  if (!agent) throw new HttpError(500, 'AT Protocol session is unavailable.');
  const record = eventRecord(fields);
  const created = await agent.com.atproto.repo.createRecord({
    repo: actor.user.id,
    collection: EVENT_COLLECTION,
    record,
  });
  const uri = created.data.uri;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO atproto_events
    (uri, did, rkey, record_json, title, sport, starts_at, location, description, level, capacity, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uri,
      actor.user.id,
      uri.split('/').at(-1),
      JSON.stringify(record),
      ...fields,
      new Date().toISOString(),
    ),
    env.DB.prepare(
      'INSERT INTO atproto_event_attendees (event_uri, attendee_id) VALUES (?, ?)',
    ).bind(uri, `atproto:${actor.user.id}`),
  ]);
  return uri;
}

/** Read a bounded set of pages from a PDS collection and report whether it is complete. */
async function listAtprotoRecords(
  agent: Agent,
  did: string,
  collection: string,
): Promise<{ records: { uri: string; value: unknown }[]; complete: boolean }> {
  const records: { uri: string; value: unknown }[] = [];
  let cursor: string | undefined;
  do {
    const response = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    records.push(...response.data.records.map(({ uri, value }) => ({ uri, value })));
    cursor = response.data.cursor;
    if (records.length >= 1000) return { records: records.slice(0, 1000), complete: !cursor };
  } while (cursor);
  return { records, complete: true };
}

/** Validate an external activity record before indexing it in D1. */
function atprotoActivityRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const { title, sport: activitySport, occurredAt, duration, distance, notes, source } = record;
  if (
    record['$type'] !== ACTIVITY_COLLECTION ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 100 ||
    typeof activitySport !== 'string' ||
    !SPORTS.includes(activitySport as Sport) ||
    typeof occurredAt !== 'string' ||
    occurredAt.length > 40 ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    new Date(occurredAt).toISOString() !== occurredAt ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > 1440 ||
    (distance != null &&
      (typeof distance !== 'number' ||
        !Number.isFinite(distance) ||
        distance < 0 ||
        distance > 2000)) ||
    typeof notes !== 'string' ||
    notes.length > 2000
  )
    return;
  return {
    $type: ACTIVITY_COLLECTION,
    title: title.trim(),
    sport: activitySport,
    occurredAt,
    duration,
    ...(distance == null ? {} : { distance }),
    notes,
    source: source === 'agent' ? 'agent' : 'web',
  };
}

/** Validate an external event record before indexing it in D1. */
function atprotoEventRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const { title, sport: eventSport, startsAt, location, description, level, capacity } = record;
  if (
    record['$type'] !== EVENT_COLLECTION ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 100 ||
    typeof eventSport !== 'string' ||
    !SPORTS.includes(eventSport as Sport) ||
    typeof startsAt !== 'string' ||
    startsAt.length > 40 ||
    !Number.isFinite(Date.parse(startsAt)) ||
    new Date(startsAt).toISOString() !== startsAt ||
    typeof location !== 'string' ||
    !location.trim() ||
    location.length > 150 ||
    typeof description !== 'string' ||
    description.length > 1000 ||
    typeof level !== 'string' ||
    !level.trim() ||
    level.length > 60 ||
    typeof capacity !== 'number' ||
    !Number.isInteger(capacity) ||
    capacity < 2 ||
    capacity > 200
  )
    return;
  return {
    $type: EVENT_COLLECTION,
    title: title.trim(),
    sport: eventSport,
    startsAt,
    location: location.trim(),
    description,
    level,
    capacity,
  };
}

/** Remove projection rows absent from a complete PDS listing, in bounded D1 batches. */
async function removeStaleAtprotoRecords(
  env: Env,
  table: 'atproto_activities' | 'atproto_events',
  did: string,
  liveUris: string[],
  startedAt: string,
): Promise<void> {
  const existing = await env.DB.prepare(`SELECT uri FROM ${table} WHERE did = ? AND indexed_at < ?`)
    .bind(did, startedAt)
    .all<{ uri: string }>();
  const live = new Set(liveUris);
  const stale = existing.results.filter(({ uri }) => !live.has(uri)).map(({ uri }) => uri);
  const deletions = [];
  for (let offset = 0; offset < stale.length; offset += 50) {
    const batch = stale.slice(offset, offset + 50);
    deletions.push(
      env.DB.prepare(
        `DELETE FROM ${table} WHERE did = ? AND uri IN (${batch.map(() => '?').join(',')})`,
      ).bind(did, ...batch),
    );
  }
  for (let offset = 0; offset < deletions.length; offset += 50)
    await env.DB.batch(deletions.slice(offset, offset + 50));
}

/** Refresh the bounded D1 projection from the user's PDS when its sync interval has elapsed. */
async function syncAtprotoData(env: Env, auth: Identity): Promise<void> {
  const agent = auth.atprotoAgent;
  if (!agent || auth.provider !== 'atproto') return;
  const account = await env.DB.prepare('SELECT updated_at FROM atproto_accounts WHERE did = ?')
    .bind(auth.user.id)
    .first<{ updated_at: string }>();
  if (account && Date.now() - Date.parse(account.updated_at) < ATPROTO_SYNC_INTERVAL_MS) return;
  const startedAt = new Date().toISOString();
  const [repo, profiles, profileRecords, activitiesResult, eventsResult] = await Promise.all([
    agent.com.atproto.repo.describeRepo({ repo: auth.user.id }).then((response) => response.data),
    agent.com.atproto.repo
      .listRecords({ repo: auth.user.id, collection: 'app.bsky.actor.profile', limit: 1 })
      .then((response) => response.data),
    agent.com.atproto.repo
      .listRecords({ repo: auth.user.id, collection: PROFILE_COLLECTION, limit: 10 })
      .then((response) => response.data),
    listAtprotoRecords(agent, auth.user.id, ACTIVITY_COLLECTION),
    listAtprotoRecords(agent, auth.user.id, EVENT_COLLECTION),
  ]);
  const appProfile = profileRecords.records.find((record) => record.uri.endsWith('/self'))?.value;
  const { name, bio, sports } = atprotoProfile(repo.handle, profiles.records[0]?.value, appProfile);
  auth.user = { ...auth.user, username: repo.handle, name, bio, sports };

  const validActivities = activitiesResult.records.flatMap((item) => {
    const record = atprotoActivityRecord(item.value);
    return record && validRecordUri(item.uri, auth.user.id, ACTIVITY_COLLECTION)
      ? [{ ...item, record }]
      : [];
  });
  const validEvents = eventsResult.records.flatMap((item) => {
    const record = atprotoEventRecord(item.value);
    return record && validRecordUri(item.uri, auth.user.id, EVENT_COLLECTION)
      ? [{ ...item, record }]
      : [];
  });
  const writes = [
    ...validActivities.map((item) =>
      env.DB.prepare(
        `INSERT INTO atproto_activities (uri, did, rkey, record_json, indexed_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(uri) DO UPDATE SET
          record_json = excluded.record_json, indexed_at = excluded.indexed_at`,
      ).bind(
        item.uri,
        auth.user.id,
        item.uri.split('/').at(-1),
        JSON.stringify(item.record),
        new Date().toISOString(),
      ),
    ),
    ...validEvents.map((item) => {
      const { record } = item;
      return env.DB.prepare(
        `INSERT INTO atproto_events
        (uri, did, rkey, record_json, title, sport, starts_at, location, description, level, capacity, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uri) DO UPDATE SET record_json = excluded.record_json,
          title = excluded.title, sport = excluded.sport, starts_at = excluded.starts_at,
          location = excluded.location, description = excluded.description,
          level = excluded.level, capacity = excluded.capacity, indexed_at = excluded.indexed_at`,
      ).bind(
        item.uri,
        auth.user.id,
        item.uri.split('/').at(-1),
        JSON.stringify(record),
        record['title'],
        record['sport'],
        record['startsAt'],
        record['location'],
        record['description'],
        record['level'],
        record['capacity'],
        new Date().toISOString(),
      );
    }),
  ];
  for (let offset = 0; offset < writes.length; offset += 50)
    await env.DB.batch(writes.slice(offset, offset + 50));
  if (activitiesResult.complete)
    await removeStaleAtprotoRecords(
      env,
      'atproto_activities',
      auth.user.id,
      validActivities.map((item) => item.uri),
      startedAt,
    );
  if (eventsResult.complete)
    await removeStaleAtprotoRecords(
      env,
      'atproto_events',
      auth.user.id,
      validEvents.map((item) => item.uri),
      startedAt,
    );
  await env.DB.prepare(
    `UPDATE atproto_accounts SET handle = ?, name = ?, bio = ?, sports = ?, updated_at = ?
    WHERE did = ?`,
  )
    .bind(repo.handle, name, bio, JSON.stringify(sports), new Date().toISOString(), auth.user.id)
    .run();
}

/** Validate hosted-event input fields and enforce the supported capacity range. */
function eventFields(data: Record<string, unknown>) {
  const capacity = number(data['capacity'], 'Capacity', 2, 200);
  if (!Number.isInteger(capacity)) throw new HttpError(400, 'Capacity must be a whole number.');
  return [
    text(data['title'], 'Title', 100),
    sport(data['sport']),
    date(data['startsAt'], true),
    text(data['location'], 'Meeting area', 150),
    text(data['description'] ?? '', 'Description', 1000, false),
    text(data['level'], 'Level', 60),
    capacity,
  ] as const;
}

/** Start or complete GitHub OAuth sign-in and create a private account session. */
async function githubAuth(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new HttpError(
      503,
      'GitHub sign-in is not configured. Add the OAuth credentials to the Worker.',
    );
  }
  const callback = `${new URL(env.APP_URL).origin}/auth/github/callback`;
  if (url.pathname === '/auth/github') {
    const state = secret();
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: callback,
      scope: 'read:user',
      state,
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorize.toString(),
        'Set-Cookie': setCookie(env, 'dwm_oauth_state', state, 600),
      },
    });
  }
  const state = url.searchParams.get('state');
  if (!state || state !== cookie(request, 'dwm_oauth_state'))
    throw new HttpError(400, 'Sign-in state expired or invalid. Please try again.');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.has('error'))
    throw new HttpError(400, 'GitHub sign-in was not approved.');
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callback,
    }),
  });
  const token = await tokenResponse.json<{ access_token?: string }>();
  if (!tokenResponse.ok || !token.access_token)
    throw new HttpError(502, 'GitHub could not complete sign-in. Please try again.');
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'devs-who-move',
    },
  });
  if (!userResponse.ok) throw new HttpError(502, 'Could not load your GitHub identity.');
  const user = await userResponse.json<{
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
    bio: string | null;
  }>();
  if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string')
    throw new HttpError(502, 'GitHub returned an invalid identity.');
  await env.DB.prepare(
    `INSERT INTO users (id, github_id, username, name, avatar, bio) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(github_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar`,
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      user.login,
      user.name || user.login,
      user.avatar_url,
      user.bio || '',
    )
    .run();
  const account = await env.DB.prepare('SELECT id FROM users WHERE github_id = ?')
    .bind(user.id)
    .first<{ id: string }>();
  if (!account) throw new HttpError(500, 'Could not create your account.');
  const session = secret();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(new Date().toISOString()),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(
      await hash(session),
      account.id,
      new Date(Date.now() + 30 * 86400_000).toISOString(),
    ),
  ]);
  const headers = new Headers({ Location: `${new URL(env.APP_URL).origin}/?welcome=1` });
  headers.append('Set-Cookie', setCookie(env, 'dwm_session', session, 30 * 86400));
  headers.append('Set-Cookie', setCookie(env, 'dwm_oauth_state', '', 0));
  return new Response(null, { status: 302, headers });
}

/** Start AT Protocol OAuth or validate its callback and create a browser session. */
async function atprotoAuth(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ATPROTO_OAUTH_PRIVATE_KEY || !env.ATPROTO_SESSION_KEY)
    throw new HttpError(
      503,
      'AT Protocol sign-in is not configured. Add the OAuth signing and session encryption keys to the Worker.',
    );
  const client = await oauthClient(env);
  if (url.pathname === '/auth/atproto') {
    const handle = url.searchParams.get('handle')?.trim();
    if (!handle || handle.length > 253)
      throw new HttpError(400, 'Enter a valid AT Protocol handle or DID.');
    const state = secret();
    const authorize = await client.authorize(handle, { state, scope: ATPROTO_OAUTH_SCOPE });
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorize.toString(),
        'Set-Cookie': setCookie(env, 'dwm_atproto_state', state, 600),
      },
    });
  }

  const result = await client.callback(url.searchParams);
  const stateCookie = cookie(request, 'dwm_atproto_state');
  if (!stateCookie || result.state !== stateCookie) {
    await client.revoke(result.session.did);
    throw new HttpError(400, 'Sign-in state expired or invalid. Please try again.');
  }

  const agent = atprotoAgent(result.session);
  const repo = (await agent.com.atproto.repo.describeRepo({ repo: result.session.did })).data;
  const [profiles, appProfiles] = await Promise.all([
    agent.com.atproto.repo
      .listRecords({
        repo: result.session.did,
        collection: 'app.bsky.actor.profile',
        limit: 1,
      })
      .then((response) => response.data),
    agent.com.atproto.repo
      .listRecords({
        repo: result.session.did,
        collection: PROFILE_COLLECTION,
        limit: 10,
      })
      .then((response) => response.data),
  ]);
  const appProfile = appProfiles.records.find((record) => record.uri.endsWith('/self'))?.value;
  const { name, bio, sports } = atprotoProfile(repo.handle, profiles.records[0]?.value, appProfile);
  await env.DB.prepare(
    `INSERT INTO atproto_accounts (did, handle, name, avatar, bio, sports, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(did) DO UPDATE SET handle = excluded.handle, name = excluded.name,
      avatar = excluded.avatar, bio = excluded.bio, sports = excluded.sports,
      updated_at = excluded.updated_at`,
  )
    .bind(
      result.session.did,
      repo.handle,
      name,
      '',
      bio,
      JSON.stringify(sports),
      '1970-01-01T00:00:00.000Z',
    )
    .run();

  const session = secret();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM atproto_sessions WHERE expires_at <= ?').bind(
      new Date().toISOString(),
    ),
    env.DB.prepare(
      'INSERT INTO atproto_sessions (token_hash, did, expires_at) VALUES (?, ?, ?)',
    ).bind(
      await hash(session),
      result.session.did,
      new Date(Date.now() + 30 * 86400_000).toISOString(),
    ),
  ]);
  const headers = new Headers({ Location: `${new URL(env.APP_URL).origin}/?welcome=1` });
  headers.append('Set-Cookie', setCookie(env, 'dwm_session', session, 30 * 86400));
  headers.append('Set-Cookie', setCookie(env, 'dwm_atproto_state', '', 0));
  return new Response(null, { status: 302, headers });
}

/** Route Worker requests to authentication, API, MCP, or static asset handlers. */
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  if (url.pathname.startsWith('/auth/github') && method === 'GET')
    return githubAuth(request, env, url);
  if (url.pathname === '/oauth/client-metadata.json' && method === 'GET') {
    if (!env.ATPROTO_OAUTH_PRIVATE_KEY || !env.ATPROTO_SESSION_KEY)
      throw new HttpError(503, 'AT Protocol OAuth is not configured.');
    return json((await oauthClient(env)).clientMetadata);
  }
  if (url.pathname === '/oauth/jwks.json' && method === 'GET') {
    if (!env.ATPROTO_OAUTH_PRIVATE_KEY || !env.ATPROTO_SESSION_KEY)
      throw new HttpError(503, 'AT Protocol OAuth is not configured.');
    return json((await oauthClient(env)).jwks);
  }
  if (url.pathname.startsWith('/auth/atproto') && method === 'GET')
    return atprotoAuth(request, env, url);
  if (url.pathname === '/mcp')
    return handleMcp(
      request,
      env.APP_URL,
      () => identity(request, env),
      (apiRequest) => handle(apiRequest, env),
    );
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

  if (!['GET', 'HEAD'].includes(method) && !request.headers.has('Authorization')) {
    if (request.headers.get('Origin') !== new URL(env.APP_URL).origin) {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
  }
  const auth = await identity(request, env);
  if (url.pathname === '/api/bootstrap' && method === 'GET') {
    if (auth?.agent)
      throw new HttpError(403, 'Use the scoped /api/activities and /api/events endpoints.');
    if (auth?.provider === 'atproto') {
      try {
        await syncAtprotoData(env, auth);
      } catch {
        console.warn('AT Protocol sync failed; serving the cached community projection.');
      }
    }
    const [feed, upcoming] = await Promise.all([
      activities(env, auth?.user.id),
      events(env, auth?.user.id),
    ]);
    return json({
      viewer: auth?.user || null,
      activities: feed,
      events: upcoming,
      githubConfigured: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      atprotoConfigured: Boolean(env.ATPROTO_OAUTH_PRIVATE_KEY && env.ATPROTO_SESSION_KEY),
    });
  }
  if (url.pathname === '/api/logout' && method === 'POST') {
    const identity = requireIdentity(auth, undefined, true);
    const session = cookie(request, 'dwm_session');
    if (session && identity.provider === 'atproto') {
      const client = await oauthClient(env);
      await client.revoke(identity.user.id);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM atproto_sessions WHERE did = ?').bind(identity.user.id),
        env.DB.prepare('DELETE FROM atproto_oauth_sessions WHERE did = ?').bind(identity.user.id),
      ]);
    } else if (session) {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
        .bind(await hash(session))
        .run();
    }
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': setCookie(env, 'dwm_session', '', 0) },
    });
  }
  if (url.pathname === '/api/me' && method === 'PATCH') {
    const identity = requireIdentity(auth, undefined, true);
    const data = await body(request);
    const sports = data['sports'];
    if (!Array.isArray(sports) || sports.length > 7)
      throw new HttpError(400, 'Choose up to seven sports.');
    const selected = [...new Set(sports.map(sport))];
    const name = text(data['name'], 'Name', 80);
    const bio = text(data['bio'], 'Bio', 300, false);
    if (identity.provider === 'atproto') {
      if (visibility(data['visibility']) !== 'public')
        throw new HttpError(400, 'AT Protocol profiles are public and cannot be made private.');
      const agent = identity.atprotoAgent;
      if (!agent) throw new HttpError(500, 'AT Protocol session is unavailable.');
      const profileChanges = atprotoProfileChanges(
        name,
        bio,
        identity.user.name,
        identity.user.bio,
      );
      if (profileChanges)
        await agent.upsertProfile((existing) => ({ ...existing, ...profileChanges }));
      const profileRecord = {
        $type: PROFILE_COLLECTION,
        sports: selected,
      };
      await agent.com.atproto.repo.putRecord({
        repo: identity.user.id,
        collection: PROFILE_COLLECTION,
        rkey: 'self',
        record: profileRecord,
      });
      await env.DB.prepare(
        'UPDATE atproto_accounts SET name = ?, bio = ?, sports = ?, updated_at = ? WHERE did = ?',
      )
        .bind(name, bio, JSON.stringify(selected), new Date().toISOString(), identity.user.id)
        .run();
      return json({ ok: true });
    }
    await env.DB.prepare(
      'UPDATE users SET name = ?, bio = ?, location = ?, sports = ?, visibility = ? WHERE id = ?',
    )
      .bind(
        name,
        bio,
        text(data['location'], 'Location', 80, false),
        JSON.stringify(selected),
        visibility(data['visibility']),
        identity.user.id,
      )
      .run();
    return json({ ok: true });
  }
  if (url.pathname === '/api/activities' && method === 'GET') {
    const identity = requireIdentity(auth, 'activities:read');
    if (identity.provider === 'atproto') {
      await syncAtprotoData(env, identity);
      return json({ activities: await atprotoActivitiesByDid(env, identity.user.id) });
    }
    const result = await env.DB.prepare(
      `${ACTIVITY_SELECT} WHERE a.user_id = ? ORDER BY a.occurred_at DESC LIMIT 100`,
    )
      .bind(identity.user.id)
      .all<Activity>();
    return json({ activities: result.results });
  }
  if (url.pathname === '/api/activities' && method === 'POST') {
    const actor = requireIdentity(auth, 'activities:write');
    const data = await body(request);
    if (actor.provider === 'atproto') {
      if (actor.agent)
        throw new HttpError(403, 'Agent writes cannot publish public AT Protocol activities.');
      if (visibility(data['visibility'] ?? 'public') !== 'public')
        throw new HttpError(
          400,
          'AT Protocol activities are public; private activities are not supported.',
        );
      const id = await saveAtprotoActivity(env, actor, data);
      return json({ id }, 201);
    }
    const entry = {
      title: text(data['title'], 'Title', 100),
      sport: sport(data['sport']),
      occurredAt: date(data['occurredAt'], false),
      duration: number(data['duration'], 'Duration in minutes', 1, 1440),
      distance:
        data['distance'] == null ? null : number(data['distance'], 'Distance in km', 0, 2000),
      notes: text(data['notes'] ?? '', 'Notes', 2000, false),
      visibility: visibility(data['visibility'] ?? 'private'),
    };
    if (actor.agent && entry.visibility !== 'private')
      throw new HttpError(
        403,
        'Agent tokens can only create private activities. Publish from the website.',
      );
    const keyHeader = request.headers.get('Idempotency-Key');
    const key = keyHeader === null ? null : text(keyHeader, 'Idempotency key', 128);
    const payloadHash = await hash(JSON.stringify(entry));
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO activities
      (id, user_id, title, sport, occurred_at, duration, distance, notes, visibility, source, idempotency_key, payload_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, idempotency_key) DO NOTHING`,
    )
      .bind(
        id,
        actor.user.id,
        entry.title,
        entry.sport,
        entry.occurredAt,
        entry.duration,
        entry.distance,
        entry.notes,
        entry.visibility,
        actor.agent ? 'agent' : 'web',
        key,
        payloadHash,
      )
      .run();
    if (key) {
      const existing = await env.DB.prepare(
        'SELECT id, payload_hash FROM activities WHERE user_id = ? AND idempotency_key = ?',
      )
        .bind(actor.user.id, key)
        .first<{ id: string; payload_hash: string }>();
      if (!existing || existing.payload_hash !== payloadHash)
        throw new HttpError(409, 'Idempotency key was already used with a different activity.');
      return json({ id: existing.id }, existing.id === id ? 201 : 200);
    }
    return json({ id }, 201);
  }
  const photoMatch = /^\/api\/activities\/([^/]+)\/photo$/.exec(url.pathname);
  if (photoMatch && method === 'GET') {
    if (auth) requireIdentity(auth, 'activities:read');
    const activityId = decodedPathPart(photoMatch[1]);
    const row = await env.DB.prepare(
      `SELECT a.photo_key AS key, a.photo_type AS type FROM activities a JOIN users u ON u.id = a.user_id
      WHERE a.id = ? AND a.photo_key IS NOT NULL
      AND (a.user_id = ? OR (a.visibility = 'public' AND u.visibility = 'public'))`,
    )
      .bind(activityId, auth?.user.id || '')
      .first<{ key: string; type: string }>();
    const object = row && (await env.PHOTOS.get(row.key));
    if (!row || !object) throw new HttpError(404, 'Photo not found.');
    return new Response(object.body, {
      headers: {
        'Content-Type': row.type,
        'Content-Length': String(object.size),
        'Cache-Control': 'private, max-age=300',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
      },
    });
  }
  if (photoMatch && (method === 'PUT' || method === 'DELETE')) {
    const actor = requireIdentity(auth, 'activities:write');
    if (actor.provider === 'atproto')
      throw new HttpError(400, 'Activity photos are not supported for AT Protocol accounts yet.');
    const activityId = decodedPathPart(photoMatch[1]);
    const current = await env.DB.prepare(
      'SELECT photo_key AS key, visibility FROM activities WHERE id = ? AND user_id = ?',
    )
      .bind(activityId, actor.user.id)
      .first<{ key: string | null; visibility: string }>();
    if (!current) throw new HttpError(404, 'Activity not found.');
    if (actor.agent && current.visibility !== 'private')
      throw new HttpError(403, 'Agent tokens can only change photos on private activities.');
    let key: string | null = null;
    let type: string | null = null;
    if (method === 'PUT') {
      const image = sanitizeImage(await readLimited(request, MAX_PHOTO_BYTES));
      key = `activities/${activityId}/${crypto.randomUUID()}`;
      type = image.type;
      await env.PHOTOS.put(key, image.bytes, { httpMetadata: { contentType: image.type } });
    }
    const result = await env.DB.prepare(
      'UPDATE activities SET photo_key = ?, photo_type = ? WHERE id = ? AND user_id = ?',
    )
      .bind(key, type, activityId, actor.user.id)
      .run();
    if (!result.meta.changes) {
      if (key) await env.PHOTOS.delete(key);
      throw new HttpError(404, 'Activity not found.');
    }
    if (current.key) await env.PHOTOS.delete(current.key);
    return json({
      photo: key ? `/api/activities/${activityId}/photo?v=${key.slice(-12)}` : null,
    });
  }
  if (url.pathname === '/api/activities/bulk-visibility' && method === 'PATCH') {
    const { user } = requireIdentity(auth, undefined, true);
    const data = await body(request);
    const rawIds = data['ids'];
    if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 100)
      throw new HttpError(400, 'Select between 1 and 100 activities.');
    const ids = [...new Set(rawIds.map((id) => text(id, 'Activity ID', 128)))];
    const nextVisibility = visibility(data['visibility']);
    const placeholders = ids.map(() => '?').join(', ');
    const result = await env.DB.prepare(
      `UPDATE activities SET visibility = ? WHERE user_id = ? AND id IN (${placeholders})
      AND (SELECT COUNT(*) FROM activities WHERE user_id = ? AND id IN (${placeholders})) = ?`,
    )
      .bind(nextVisibility, user.id, ...ids, user.id, ...ids, ids.length)
      .run();
    if (result.meta.changes !== ids.length) throw new HttpError(404, 'Activity not found.');
    return json({ ok: true, updated: ids.length });
  }
  const activityMatch = /^\/api\/activities\/([^/]+)$/.exec(url.pathname);
  if (activityMatch && (method === 'PATCH' || method === 'DELETE')) {
    const identity = requireIdentity(auth, undefined, true);
    const activityId = decodedPathPart(activityMatch[1]);
    if (identity.provider === 'atproto') {
      if (method === 'DELETE') {
        const key = recordKey(activityId, identity.user.id, ACTIVITY_COLLECTION);
        const agent = identity.atprotoAgent;
        if (!agent) throw new HttpError(500, 'AT Protocol session is unavailable.');
        await agent.com.atproto.repo.deleteRecord({
          repo: identity.user.id,
          collection: ACTIVITY_COLLECTION,
          rkey: key,
        });
        await env.DB.prepare('DELETE FROM atproto_activities WHERE uri = ? AND did = ?')
          .bind(activityId, identity.user.id)
          .run();
      } else {
        const data = await body(request);
        if (visibility(data['visibility']) !== 'public')
          throw new HttpError(400, 'AT Protocol activities are public and cannot be made private.');
        const exists = await env.DB.prepare(
          'SELECT 1 AS found FROM atproto_activities WHERE uri = ? AND did = ?',
        )
          .bind(activityId, identity.user.id)
          .first();
        if (!exists) throw new HttpError(404, 'Activity not found.');
      }
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const deleted = await env.DB.prepare(
        'DELETE FROM activities WHERE id = ? AND user_id = ? RETURNING photo_key AS key',
      )
        .bind(activityId, identity.user.id)
        .first<{ key: string | null }>();
      if (!deleted) throw new HttpError(404, 'Activity not found.');
      if (deleted.key) await env.PHOTOS.delete(deleted.key);
    } else {
      const data = await body(request);
      const result = await env.DB.prepare(
        'UPDATE activities SET visibility = ? WHERE id = ? AND user_id = ?',
      )
        .bind(visibility(data['visibility']), activityId, identity.user.id)
        .run();
      if (!result.meta.changes) throw new HttpError(404, 'Activity not found.');
    }
    return json({ ok: true });
  }
  if (url.pathname === '/api/events' && method === 'GET') {
    if (auth) requireIdentity(auth, 'events:read');
    return json({ events: await events(env, auth?.user.id) });
  }
  if (url.pathname === '/api/events' && method === 'POST') {
    const identity = requireIdentity(auth, undefined, true);
    const fields = eventFields(await body(request));
    if (identity.provider === 'atproto') {
      const id = await saveAtprotoEvent(env, identity, fields);
      return json({ id }, 201);
    }
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events (id, host_id, title, sport, starts_at, location, description, level, capacity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, identity.user.id, ...fields),
      env.DB.prepare('INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)').bind(
        id,
        identity.user.id,
      ),
    ]);
    return json({ id }, 201);
  }
  const eventMatch = /^\/api\/events\/([^/]+)(\/join)?$/.exec(url.pathname);
  const eventId = eventMatch ? decodedPathPart(eventMatch[1]) : '';
  if (eventMatch && !eventMatch[2] && method === 'PATCH') {
    const identity = requireIdentity(auth, undefined, true);
    const fields = eventFields(await body(request));
    if (eventId.startsWith('at://')) {
      if (identity.provider !== 'atproto')
        throw new HttpError(403, 'Only the AT Protocol event host can edit this event.');
      const key = recordKey(eventId, identity.user.id, EVENT_COLLECTION);
      const event = await env.DB.prepare(
        `SELECT record_json AS record, starts_at AS startsAt,
          (SELECT COUNT(*) FROM atproto_event_attendees WHERE event_uri = atproto_events.uri) AS attendees
        FROM atproto_events WHERE uri = ? AND did = ?`,
      )
        .bind(eventId, identity.user.id)
        .first<{ record: string; startsAt: string; attendees: number }>();
      if (!event || event.startsAt <= new Date().toISOString())
        throw new HttpError(404, 'Event is no longer available.');
      if (event.attendees > fields[6])
        throw new HttpError(
          409,
          `${event.attendees} people are already going. Capacity can’t be lower than that.`,
        );
      const nextRecord = eventRecord(fields);
      const indexed = await env.DB.prepare(
        `UPDATE atproto_events SET record_json = ?, title = ?, sport = ?, starts_at = ?,
          location = ?, description = ?, level = ?, capacity = ?
        WHERE uri = ? AND did = ? AND
          (SELECT COUNT(*) FROM atproto_event_attendees WHERE event_uri = ?) <= ?`,
      )
        .bind(
          JSON.stringify(nextRecord),
          ...fields.slice(0, 6),
          fields[6],
          eventId,
          identity.user.id,
          eventId,
          fields[6],
        )
        .run();
      if (!indexed.meta.changes)
        throw new HttpError(409, 'Event capacity changed. Please review the attendee count.');
      try {
        await identity.atprotoAgent!.com.atproto.repo.putRecord({
          repo: identity.user.id,
          collection: EVENT_COLLECTION,
          rkey: key,
          record: nextRecord,
        });
      } catch (error) {
        const previous = JSON.parse(event.record) as Record<string, unknown>;
        await env.DB.prepare(
          `UPDATE atproto_events SET record_json = ?, title = ?, sport = ?, starts_at = ?,
            location = ?, description = ?, level = ?, capacity = ? WHERE uri = ? AND did = ?`,
        )
          .bind(
            event.record,
            previous['title'],
            previous['sport'],
            previous['startsAt'],
            previous['location'],
            previous['description'],
            previous['level'],
            previous['capacity'],
            eventId,
            identity.user.id,
          )
          .run();
        throw error;
      }
      return json({ ok: true });
    }
    const id = eventId;
    const event = await env.DB.prepare(
      `SELECT host_id, starts_at, cancelled,
      (SELECT COUNT(*) FROM event_attendees WHERE event_id = events.id) +
      (SELECT COUNT(*) FROM atproto_external_event_attendees WHERE event_id = events.id) AS attendees
      FROM events WHERE id = ?`,
    )
      .bind(id)
      .first<{ host_id: string; starts_at: string; cancelled: number; attendees: number }>();
    if (!event || event.cancelled || event.starts_at <= new Date().toISOString())
      throw new HttpError(404, 'Event is no longer available.');
    if (event.host_id !== identity.user.id)
      throw new HttpError(403, 'Only the host can edit an event.');
    const result = await env.DB.prepare(
      `UPDATE events SET title = ?, sport = ?, starts_at = ?, location = ?, description = ?,
      level = ?, capacity = ? WHERE id = ? AND host_id = ? AND cancelled = 0
      AND (SELECT COUNT(*) FROM event_attendees WHERE event_id = ?) +
      (SELECT COUNT(*) FROM atproto_external_event_attendees WHERE event_id = ?) <= ?`,
    )
      .bind(...fields, id, identity.user.id, id, id, fields[6])
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        409,
        `${event.attendees} people are already going. Capacity can’t be lower than that.`,
      );
    return json({ ok: true });
  }
  if (eventMatch && method === 'POST') {
    const identity = requireIdentity(auth, undefined, true);
    if (eventId.startsWith('at://')) {
      const event = await env.DB.prepare(
        `SELECT did, starts_at AS startsAt FROM atproto_events WHERE uri = ?`,
      )
        .bind(eventId)
        .first<{ did: string; startsAt: string }>();
      if (!event || event.startsAt <= new Date().toISOString())
        throw new HttpError(404, 'Event is no longer available.');
      if (eventMatch[2]) {
        const data = await body(request);
        if (typeof data['join'] !== 'boolean')
          throw new HttpError(400, 'Specify whether to join or leave.');
        const attendeeId = `${identity.provider}:${identity.user.id}`;
        if (data['join']) {
          if (event.did === identity.user.id)
            throw new HttpError(400, 'As host, cancel the event instead of joining.');
          await env.DB.prepare(
            `INSERT OR IGNORE INTO atproto_event_attendees (event_uri, attendee_id)
            SELECT uri, ? FROM atproto_events WHERE uri = ? AND starts_at > ? AND
              (SELECT COUNT(*) FROM atproto_event_attendees WHERE event_uri = ?) < capacity`,
          )
            .bind(attendeeId, eventId, new Date().toISOString(), eventId)
            .run();
          const joined = await env.DB.prepare(
            'SELECT 1 AS joined FROM atproto_event_attendees WHERE event_uri = ? AND attendee_id = ?',
          )
            .bind(eventId, attendeeId)
            .first();
          if (!joined) throw new HttpError(409, 'This event is full.');
        } else {
          if (event.did === identity.user.id)
            throw new HttpError(400, 'As host, cancel the event instead of leaving.');
          await env.DB.prepare(
            'DELETE FROM atproto_event_attendees WHERE event_uri = ? AND attendee_id = ?',
          )
            .bind(eventId, attendeeId)
            .run();
        }
      } else {
        if (identity.provider !== 'atproto' || event.did !== identity.user.id)
          throw new HttpError(403, 'Only the host can cancel an event.');
        const key = recordKey(eventId, identity.user.id, EVENT_COLLECTION);
        await identity.atprotoAgent!.com.atproto.repo.deleteRecord({
          repo: identity.user.id,
          collection: EVENT_COLLECTION,
          rkey: key,
        });
        await env.DB.prepare('DELETE FROM atproto_events WHERE uri = ? AND did = ?')
          .bind(eventId, identity.user.id)
          .run();
      }
      return json({ ok: true });
    }
    const id = eventId;
    const event = await env.DB.prepare(
      'SELECT host_id, starts_at, cancelled FROM events WHERE id = ?',
    )
      .bind(id)
      .first<{ host_id: string; starts_at: string; cancelled: number }>();
    if (!event || event.cancelled || event.starts_at <= new Date().toISOString())
      throw new HttpError(404, 'Event is no longer available.');
    if (eventMatch[2]) {
      const data = await body(request);
      if (typeof data['join'] !== 'boolean')
        throw new HttpError(400, 'Specify whether to join or leave.');
      if (data['join']) {
        if (identity.provider === 'atproto') {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO atproto_external_event_attendees (event_id, attendee_id)
            SELECT id, ? FROM events WHERE id = ? AND cancelled = 0 AND
              (SELECT COUNT(*) FROM event_attendees WHERE event_id = ?) +
              (SELECT COUNT(*) FROM atproto_external_event_attendees WHERE event_id = ?) < capacity`,
          )
            .bind(`atproto:${identity.user.id}`, id, id, id)
            .run();
        } else {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO event_attendees (event_id, user_id)
            SELECT id, ? FROM events WHERE id = ? AND cancelled = 0 AND
              (SELECT COUNT(*) FROM event_attendees WHERE event_id = ?) +
              (SELECT COUNT(*) FROM atproto_external_event_attendees WHERE event_id = ?) < capacity`,
          )
            .bind(identity.user.id, id, id, id)
            .run();
        }
        const joined =
          identity.provider === 'atproto'
            ? await env.DB.prepare(
                'SELECT 1 AS joined FROM atproto_external_event_attendees WHERE event_id = ? AND attendee_id = ?',
              )
                .bind(id, `atproto:${identity.user.id}`)
                .first()
            : await env.DB.prepare(
                'SELECT 1 AS joined FROM event_attendees WHERE event_id = ? AND user_id = ?',
              )
                .bind(id, identity.user.id)
                .first();
        if (!joined) throw new HttpError(409, 'This event is full.');
      } else {
        if (event.host_id === identity.user.id)
          throw new HttpError(400, 'As host, cancel the event instead of leaving.');
        if (identity.provider === 'atproto') {
          await env.DB.prepare(
            'DELETE FROM atproto_external_event_attendees WHERE event_id = ? AND attendee_id = ?',
          )
            .bind(id, `atproto:${identity.user.id}`)
            .run();
        } else {
          await env.DB.prepare('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?')
            .bind(id, identity.user.id)
            .run();
        }
      }
    } else {
      if (event.host_id !== identity.user.id)
        throw new HttpError(403, 'Only the host can cancel an event.');
      await env.DB.prepare('UPDATE events SET cancelled = 1 WHERE id = ?').bind(id).run();
    }
    return json({ ok: true });
  }
  if (url.pathname === '/api/tokens' && method === 'GET') {
    const identity = requireIdentity(auth, undefined, true);
    if (identity.provider === 'atproto') {
      const result = await env.DB.prepare(
        `SELECT id, name, scopes, created_at AS createdAt, expires_at AS expiresAt
        FROM atproto_agent_tokens WHERE did = ? ORDER BY created_at DESC`,
      )
        .bind(identity.user.id)
        .all<{ id: string; name: string; scopes: string; createdAt: string; expiresAt: string }>();
      return json({
        tokens: result.results.map((token) => ({ ...token, scopes: JSON.parse(token.scopes) })),
      });
    }
    const result = await env.DB.prepare(
      `SELECT id, name, scopes, created_at AS createdAt, expires_at AS expiresAt
      FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    )
      .bind(identity.user.id)
      .all<{ id: string; name: string; scopes: string; createdAt: string; expiresAt: string }>();
    return json({
      tokens: result.results.map((token) => ({ ...token, scopes: JSON.parse(token.scopes) })),
    });
  }
  if (url.pathname === '/api/tokens' && method === 'POST') {
    const identity = requireIdentity(auth, undefined, true);
    const data = await body(request);
    const scopes = data['scopes'];
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      !scopes.every((scope) => ALL_SCOPES.includes(scope))
    ) {
      throw new HttpError(400, 'Choose at least one supported permission.');
    }
    const token = `dwm_${secret()}`;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 90 * 86400_000).toISOString();
    const tokenHash = await hash(token);
    const name = text(data['name'], 'Agent name', 60);
    const result =
      identity.provider === 'atproto'
        ? await env.DB.prepare(
            `INSERT INTO atproto_agent_tokens (id, did, token_hash, name, scopes, created_at, expires_at)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE
            (SELECT COUNT(*) FROM atproto_agent_tokens WHERE did = ? AND expires_at > ?) < 10`,
          )
            .bind(
              id,
              identity.user.id,
              tokenHash,
              name,
              JSON.stringify([...new Set(scopes)]),
              createdAt,
              expiresAt,
              identity.user.id,
              createdAt,
            )
            .run()
        : await env.DB.prepare(
            `INSERT INTO agent_tokens (id, user_id, token_hash, name, scopes, created_at, expires_at)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE
            (SELECT COUNT(*) FROM agent_tokens WHERE user_id = ? AND expires_at > ?) < 10`,
          )
            .bind(
              id,
              identity.user.id,
              tokenHash,
              name,
              JSON.stringify([...new Set(scopes)]),
              createdAt,
              expiresAt,
              identity.user.id,
              createdAt,
            )
            .run();
    if (!result.meta.changes)
      throw new HttpError(400, 'You can have at most ten active agent tokens. Revoke one first.');
    return json({ id, token, expiresAt }, 201);
  }
  const tokenMatch = /^\/api\/tokens\/([^/]+)$/.exec(url.pathname);
  if (tokenMatch && method === 'DELETE') {
    const identity = requireIdentity(auth, undefined, true);
    const tokenId = decodedPathPart(tokenMatch[1]);
    const result =
      identity.provider === 'atproto'
        ? await env.DB.prepare('DELETE FROM atproto_agent_tokens WHERE id = ? AND did = ?')
            .bind(tokenId, identity.user.id)
            .run()
        : await env.DB.prepare('DELETE FROM agent_tokens WHERE id = ? AND user_id = ?')
            .bind(tokenId, identity.user.id)
            .run();
    if (!result.meta.changes) throw new HttpError(404, 'Agent token not found.');
    return json({ ok: true });
  }
  const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname);
  if (profileMatch && method === 'GET') {
    if (auth?.agent) throw new HttpError(403, 'Agent tokens cannot read profiles.');
    const username = decodedPathPart(profileMatch[1]);
    const row = await env.DB.prepare(
      `SELECT id, username, name, avatar, bio, location, sports, visibility
      FROM users WHERE username = ? AND (visibility = 'public' OR id = ?)`,
    )
      .bind(username, auth?.user.id || '')
      .first<UserRow>();
    if (row)
      return json({
        profile: profile(row),
        activities: await profileActivities(env, row.id, auth?.user.id || ''),
      });
    const atprotoRow = await env.DB.prepare(
      `SELECT did AS id, handle AS username, name, avatar, bio, '' AS location,
        sports, 'public' AS visibility
      FROM atproto_accounts WHERE handle = ? OR did = ?
      ORDER BY updated_at DESC, did LIMIT 1`,
    )
      .bind(username, username)
      .first<UserRow>();
    if (!atprotoRow) throw new HttpError(404, 'Profile is private or does not exist.');
    return json({
      profile: { ...profile(atprotoRow), provider: 'atproto' },
      activities: await profileActivities(env, atprotoRow.id, auth?.user.id || ''),
    });
  }
  throw new HttpError(404, 'Endpoint not found.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await handle(request, env);
      const secured = new Response(response.body, response);
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      secured.headers.set('Referrer-Policy', 'same-origin');
      secured.headers.set('X-Frame-Options', 'DENY');
      secured.headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
      if (new URL(request.url).pathname.startsWith('/auth/'))
        secured.headers.set('Cache-Control', 'no-store');
      return secured;
    } catch (error) {
      if (error instanceof HttpError) {
        const response = json({ error: error.message }, error.status);
        if (new URL(request.url).pathname === '/mcp' && error.status === 401) {
          response.headers.set(
            'WWW-Authenticate',
            'Bearer realm="devs-who-move MCP", scope="activities:read activities:write events:read"',
          );
        }
        return response;
      }
      console.error(
        'Worker request failed',
        error instanceof Error ? error.message : 'Unknown error',
      );
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
