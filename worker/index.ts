import type { Activity, AgentScope, Profile, SportEvent } from '../src/app/models';
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
}

interface UserRow extends Omit<Profile, 'sports'> {
  sports: string;
}
interface Identity {
  user: Profile;
  agent: boolean;
  scopes: AgentScope[];
}
const ALL_SCOPES: AgentScope[] = ['activities:read', 'activities:write', 'events:read'];
const ACTIVITY_SELECT = `SELECT a.id, a.user_id AS userId, u.username, u.name, u.avatar,
  a.title, a.sport, a.occurred_at AS occurredAt, a.duration, a.distance, a.notes,
  a.visibility, a.source,
  CASE WHEN a.photo_key IS NULL THEN NULL
    ELSE '/api/activities/' || a.id || '/photo?v=' || substr(a.photo_key, -12) END AS photo
  FROM activities a JOIN users u ON u.id = a.user_id`;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function cookie(request: Request, name: string): string | undefined {
  return request.headers
    .get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function setCookie(env: Env, name: string, value: string, age: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(env.APP_URL).protocol === 'https:' ? '; Secure' : ''}`;
}

function profile(row: UserRow): Profile {
  return { ...row, sports: JSON.parse(row.sports) };
}

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
    if (!token) throw new HttpError(401, 'Agent token expired or revoked.');
    const row = await env.DB.prepare(
      'SELECT id, username, name, avatar, bio, location, sports, visibility FROM users WHERE id = ?',
    )
      .bind(token.user_id)
      .first<UserRow>();
    if (!row) throw new HttpError(401, 'Account no longer exists.');
    return { user: profile(row), agent: true, scopes: JSON.parse(token.scopes) };
  }
  const session = cookie(request, 'dwm_session');
  if (!session) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.avatar, u.bio, u.location, u.sports, u.visibility
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hash(session), new Date().toISOString())
    .first<UserRow>();
  return row ? { user: profile(row), agent: false, scopes: ALL_SCOPES } : null;
}

function requireIdentity(auth: Identity | null, scope?: AgentScope, browserOnly = false): Identity {
  if (!auth) throw new HttpError(401, 'Sign in with GitHub to continue.');
  if (browserOnly && auth.agent)
    throw new HttpError(403, 'This action requires a browser session.');
  if (scope && !auth.scopes.includes(scope))
    throw new HttpError(403, `This token needs ${scope} permission.`);
  return auth;
}

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

async function activities(env: Env, userId?: string): Promise<Activity[]> {
  const result = await env.DB.prepare(
    `${ACTIVITY_SELECT}
    WHERE (a.user_id = ? OR (a.visibility = 'public' AND u.visibility = 'public'))
    ORDER BY a.occurred_at DESC LIMIT 100`,
  )
    .bind(userId || '')
    .all<Activity>();
  return result.results;
}

async function events(env: Env, userId?: string): Promise<SportEvent[]> {
  const result = await env.DB.prepare(
    `SELECT e.id, e.host_id AS hostId, u.name AS hostName,
    e.title, e.sport, e.starts_at AS startsAt, e.location, e.description, e.level, e.capacity,
    (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id) AS attendees,
    EXISTS(SELECT 1 FROM event_attendees WHERE event_id = e.id AND user_id = ?) AS joined
    FROM events e JOIN users u ON u.id = e.host_id
    WHERE e.cancelled = 0 AND e.starts_at > ? ORDER BY e.starts_at LIMIT 100`,
  )
    .bind(userId || '', new Date().toISOString())
    .all<SportEvent>();
  return result.results.map((event) => ({ ...event, joined: Boolean(event.joined) }));
}

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

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  if (url.pathname.startsWith('/auth/github') && method === 'GET')
    return githubAuth(request, env, url);
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
    const [feed, upcoming] = await Promise.all([
      activities(env, auth?.user.id),
      events(env, auth?.user.id),
    ]);
    return json({
      viewer: auth?.user || null,
      activities: feed,
      events: upcoming,
      githubConfigured: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    });
  }
  if (url.pathname === '/api/logout' && method === 'POST') {
    requireIdentity(auth, undefined, true);
    const session = cookie(request, 'dwm_session');
    if (session)
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
        .bind(await hash(session))
        .run();
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': setCookie(env, 'dwm_session', '', 0) },
    });
  }
  if (url.pathname === '/api/me' && method === 'PATCH') {
    const { user } = requireIdentity(auth, undefined, true);
    const data = await body(request);
    const sports = data['sports'];
    if (!Array.isArray(sports) || sports.length > 7)
      throw new HttpError(400, 'Choose up to seven sports.');
    const selected = [...new Set(sports.map(sport))];
    await env.DB.prepare(
      'UPDATE users SET name = ?, bio = ?, location = ?, sports = ?, visibility = ? WHERE id = ?',
    )
      .bind(
        text(data['name'], 'Name', 80),
        text(data['bio'], 'Bio', 300, false),
        text(data['location'], 'Location', 80, false),
        JSON.stringify(selected),
        visibility(data['visibility']),
        user.id,
      )
      .run();
    return json({ ok: true });
  }
  if (url.pathname === '/api/activities' && method === 'GET') {
    const { user } = requireIdentity(auth, 'activities:read');
    const result = await env.DB.prepare(
      `${ACTIVITY_SELECT} WHERE a.user_id = ? ORDER BY a.occurred_at DESC LIMIT 100`,
    )
      .bind(user.id)
      .all<Activity>();
    return json({ activities: result.results });
  }
  if (url.pathname === '/api/activities' && method === 'POST') {
    const actor = requireIdentity(auth, 'activities:write');
    const data = await body(request);
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
    const row = await env.DB.prepare(
      `SELECT a.photo_key AS key, a.photo_type AS type FROM activities a JOIN users u ON u.id = a.user_id
      WHERE a.id = ? AND a.photo_key IS NOT NULL
      AND (a.user_id = ? OR (a.visibility = 'public' AND u.visibility = 'public'))`,
    )
      .bind(photoMatch[1], auth?.user.id || '')
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
    const current = await env.DB.prepare(
      'SELECT photo_key AS key, visibility FROM activities WHERE id = ? AND user_id = ?',
    )
      .bind(photoMatch[1], actor.user.id)
      .first<{ key: string | null; visibility: string }>();
    if (!current) throw new HttpError(404, 'Activity not found.');
    if (actor.agent && current.visibility !== 'private')
      throw new HttpError(403, 'Agent tokens can only change photos on private activities.');
    let key: string | null = null;
    let type: string | null = null;
    if (method === 'PUT') {
      const image = sanitizeImage(await readLimited(request, MAX_PHOTO_BYTES));
      key = `activities/${photoMatch[1]}/${crypto.randomUUID()}`;
      type = image.type;
      await env.PHOTOS.put(key, image.bytes, { httpMetadata: { contentType: image.type } });
    }
    const result = await env.DB.prepare(
      'UPDATE activities SET photo_key = ?, photo_type = ? WHERE id = ? AND user_id = ?',
    )
      .bind(key, type, photoMatch[1], actor.user.id)
      .run();
    if (!result.meta.changes) {
      if (key) await env.PHOTOS.delete(key);
      throw new HttpError(404, 'Activity not found.');
    }
    if (current.key) await env.PHOTOS.delete(current.key);
    return json({
      photo: key ? `/api/activities/${photoMatch[1]}/photo?v=${key.slice(-12)}` : null,
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
    const { user } = requireIdentity(auth, undefined, true);
    if (method === 'DELETE') {
      const deleted = await env.DB.prepare(
        'DELETE FROM activities WHERE id = ? AND user_id = ? RETURNING photo_key AS key',
      )
        .bind(activityMatch[1], user.id)
        .first<{ key: string | null }>();
      if (!deleted) throw new HttpError(404, 'Activity not found.');
      if (deleted.key) await env.PHOTOS.delete(deleted.key);
    } else {
      const data = await body(request);
      const result = await env.DB.prepare(
        'UPDATE activities SET visibility = ? WHERE id = ? AND user_id = ?',
      )
        .bind(visibility(data['visibility']), activityMatch[1], user.id)
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
    const { user } = requireIdentity(auth, undefined, true);
    const fields = eventFields(await body(request));
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events (id, host_id, title, sport, starts_at, location, description, level, capacity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, user.id, ...fields),
      env.DB.prepare('INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)').bind(
        id,
        user.id,
      ),
    ]);
    return json({ id }, 201);
  }
  const eventMatch = /^\/api\/events\/([^/]+)(\/join)?$/.exec(url.pathname);
  if (eventMatch && !eventMatch[2] && method === 'PATCH') {
    const { user } = requireIdentity(auth, undefined, true);
    const id = eventMatch[1];
    const fields = eventFields(await body(request));
    const event = await env.DB.prepare(
      `SELECT host_id, starts_at, cancelled,
      (SELECT COUNT(*) FROM event_attendees WHERE event_id = events.id) AS attendees
      FROM events WHERE id = ?`,
    )
      .bind(id)
      .first<{ host_id: string; starts_at: string; cancelled: number; attendees: number }>();
    if (!event || event.cancelled || event.starts_at <= new Date().toISOString())
      throw new HttpError(404, 'Event is no longer available.');
    if (event.host_id !== user.id) throw new HttpError(403, 'Only the host can edit an event.');
    const result = await env.DB.prepare(
      `UPDATE events SET title = ?, sport = ?, starts_at = ?, location = ?, description = ?,
      level = ?, capacity = ? WHERE id = ? AND host_id = ? AND cancelled = 0
      AND (SELECT COUNT(*) FROM event_attendees WHERE event_id = ?) <= ?`,
    )
      .bind(...fields, id, user.id, id, fields[6])
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        409,
        `${event.attendees} people are already going. Capacity can’t be lower than that.`,
      );
    return json({ ok: true });
  }
  if (eventMatch && method === 'POST') {
    const { user } = requireIdentity(auth, undefined, true);
    const id = eventMatch[1];
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
        await env.DB.prepare(
          `INSERT OR IGNORE INTO event_attendees (event_id, user_id)
          SELECT id, ? FROM events WHERE id = ? AND cancelled = 0 AND
          (SELECT COUNT(*) FROM event_attendees WHERE event_id = ?) < capacity`,
        )
          .bind(user.id, id, id)
          .run();
        const joined = await env.DB.prepare(
          'SELECT 1 AS joined FROM event_attendees WHERE event_id = ? AND user_id = ?',
        )
          .bind(id, user.id)
          .first();
        if (!joined) throw new HttpError(409, 'This event is full.');
      } else {
        if (event.host_id === user.id)
          throw new HttpError(400, 'As host, cancel the event instead of leaving.');
        await env.DB.prepare('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?')
          .bind(id, user.id)
          .run();
      }
    } else {
      if (event.host_id !== user.id) throw new HttpError(403, 'Only the host can cancel an event.');
      await env.DB.prepare('UPDATE events SET cancelled = 1 WHERE id = ?').bind(id).run();
    }
    return json({ ok: true });
  }
  if (url.pathname === '/api/tokens' && method === 'GET') {
    const { user } = requireIdentity(auth, undefined, true);
    const result = await env.DB.prepare(
      `SELECT id, name, scopes, created_at AS createdAt, expires_at AS expiresAt
      FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    )
      .bind(user.id)
      .all<{ id: string; name: string; scopes: string; createdAt: string; expiresAt: string }>();
    return json({
      tokens: result.results.map((token) => ({ ...token, scopes: JSON.parse(token.scopes) })),
    });
  }
  if (url.pathname === '/api/tokens' && method === 'POST') {
    const { user } = requireIdentity(auth, undefined, true);
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
    const result = await env.DB.prepare(
      `INSERT INTO agent_tokens (id, user_id, token_hash, name, scopes, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM agent_tokens WHERE user_id = ? AND expires_at > ?) < 10`,
    )
      .bind(
        id,
        user.id,
        await hash(token),
        text(data['name'], 'Agent name', 60),
        JSON.stringify([...new Set(scopes)]),
        createdAt,
        expiresAt,
        user.id,
        createdAt,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(400, 'You can have at most ten active agent tokens. Revoke one first.');
    return json({ id, token, expiresAt }, 201);
  }
  const tokenMatch = /^\/api\/tokens\/([^/]+)$/.exec(url.pathname);
  if (tokenMatch && method === 'DELETE') {
    const { user } = requireIdentity(auth, undefined, true);
    const result = await env.DB.prepare('DELETE FROM agent_tokens WHERE id = ? AND user_id = ?')
      .bind(tokenMatch[1], user.id)
      .run();
    if (!result.meta.changes) throw new HttpError(404, 'Agent token not found.');
    return json({ ok: true });
  }
  const profileMatch = /^\/api\/profiles\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
  if (profileMatch && method === 'GET') {
    if (auth?.agent) throw new HttpError(403, 'Agent tokens cannot read profiles.');
    const row = await env.DB.prepare(
      `SELECT id, username, name, avatar, bio, location, sports, visibility
      FROM users WHERE username = ? AND (visibility = 'public' OR id = ?)`,
    )
      .bind(profileMatch[1], auth?.user.id || '')
      .first<UserRow>();
    if (!row) throw new HttpError(404, 'Profile is private or does not exist.');
    const result = await env.DB.prepare(
      `${ACTIVITY_SELECT} WHERE a.user_id = ?
      AND (a.visibility = 'public' OR a.user_id = ?) ORDER BY a.occurred_at DESC LIMIT 100`,
    )
      .bind(row.id, auth?.user.id || '')
      .all<Activity>();
    return json({ profile: profile(row), activities: result.results });
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
