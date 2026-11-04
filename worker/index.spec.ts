import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

describe('Worker with real D1 storage', () => {
  let runtime: Miniflare;
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
  const origin = 'http://localhost:8787';
  const alice = 'a'.repeat(64);
  const bob = 'b'.repeat(64);
  const charlie = 'c'.repeat(64);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const activity = {
    title: 'Before standup',
    sport: 'Running',
    occurredAt: '2026-01-01T08:00:00.000Z',
    duration: 31,
    distance: 5,
    notes: 'Easy pace.',
    visibility: 'private',
  };
  let eventId: string;
  let activityId: string;
  let token: string;
  let tokenId: string;

  async function request(
    path: string,
    method = 'GET',
    data?: unknown,
    session?: string,
    bearer?: string,
    extra?: Record<string, string>,
  ) {
    return runtime.dispatchFetch(`${origin}${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(session ? { Cookie: `dwm_session=${session}` } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extra,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  }

  beforeAll(async () => {
    const bundled = await build({
      entryPoints: ['worker/index.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
    });
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: '2026-11-03',
        d1Databases: ['DB'],
        bindings: { APP_URL: origin },
      }),
    );
    db = await runtime.getD1Database('DB');
    const migration = await readFile(
      new URL('../migrations/0001_initial.sql', import.meta.url),
      'utf8',
    );
    for (const statement of migration
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
    for (const [id, session, visibility] of [
      ['alice', alice, 'public'],
      ['bob', bob, 'private'],
      ['charlie', charlie, 'public'],
    ]) {
      await db
        .prepare(
          'INSERT INTO users (id, github_id, username, name, visibility) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, id.charCodeAt(0), id, id, visibility)
        .run();
      await db
        .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(hash(session), id, '2099-01-01T00:00:00.000Z')
        .run();
    }
  });

  afterAll(async () => {
    await runtime?.dispose();
  });

  it('serves an empty anonymous community without leaking profiles', async () => {
    const response = await request('/api/bootstrap');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      viewer: null,
      activities: [],
      events: [],
      githubConfigured: false,
    });
  });

  it('rejects anonymous writes, invalid bearer tokens, and cross-site browser writes', async () => {
    expect((await request('/api/activities', 'POST', activity)).status).toBe(401);
    expect((await request('/api/activities', 'POST', activity, undefined, 'invalid')).status).toBe(
      401,
    );
    expect(
      (
        await request('/api/activities', 'POST', activity, alice, undefined, {
          Origin: 'https://other.example',
        })
      ).status,
    ).toBe(403);
  });

  it('persists private activities and excludes them from another person’s feed', async () => {
    const response = await request('/api/activities', 'POST', activity, alice);
    expect(response.status).toBe(201);
    activityId = (await response.json<{ id: string }>()).id;
    const own = await (
      await request('/api/bootstrap', 'GET', undefined, alice)
    ).json<{ activities: unknown[] }>();
    const other = await (
      await request('/api/bootstrap', 'GET', undefined, bob)
    ).json<{ activities: unknown[] }>();
    expect(own.activities).toHaveLength(1);
    expect(other.activities).toHaveLength(0);
  });

  it('shows public activities only while their owner’s profile is public', async () => {
    expect(
      (await request(`/api/activities/${activityId}`, 'PATCH', { visibility: 'public' }, alice))
        .status,
    ).toBe(200);
    let feed = await (await request('/api/bootstrap')).json<{ activities: unknown[] }>();
    expect(feed.activities).toHaveLength(1);
    expect(
      (
        await request(
          '/api/me',
          'PATCH',
          { name: 'Alice', bio: '', location: '', sports: ['Running'], visibility: 'private' },
          alice,
        )
      ).status,
    ).toBe(200);
    feed = await (await request('/api/bootstrap')).json<{ activities: unknown[] }>();
    expect(feed.activities).toHaveLength(0);
    expect((await request('/api/profiles/alice')).status).toBe(404);
    expect((await request('/api/profiles/alice', 'GET', undefined, alice)).status).toBe(200);
  });

  it('enforces activity ownership and validates metrics', async () => {
    expect((await request(`/api/activities/${activityId}`, 'DELETE', undefined, bob)).status).toBe(
      404,
    );
    expect(
      (await request('/api/activities', 'POST', { ...activity, duration: -1 }, alice)).status,
    ).toBe(400);
    expect(
      (await request('/api/activities', 'POST', { ...activity, sport: 'Coding' }, alice)).status,
    ).toBe(400);
    expect(
      (
        await request(
          '/api/activities',
          'POST',
          { ...activity, occurredAt: '2099-01-01T00:00:00Z' },
          alice,
        )
      ).status,
    ).toBe(400);
  });

  it('creates expiring scoped tokens and never returns their hashes in listings', async () => {
    const response = await request(
      '/api/tokens',
      'POST',
      { name: 'Running buddy', scopes: ['activities:write'] },
      alice,
    );
    expect(response.status).toBe(201);
    const result = await response.json<{ id: string; token: string; expiresAt: string }>();
    token = result.token;
    tokenId = result.id;
    expect(token).toMatch(/^dwm_[a-f0-9]{64}$/);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    const listing = await (await request('/api/tokens', 'GET', undefined, alice)).text();
    expect(listing).not.toContain(token);
    expect(listing).not.toContain('token_hash');
  });

  it('lets agents upload private activities idempotently but never publish', async () => {
    const headers = { 'Idempotency-Key': 'first-run' };
    const first = await request('/api/activities', 'POST', activity, undefined, token, headers);
    expect(first.status).toBe(201);
    const second = await request('/api/activities', 'POST', activity, undefined, token, headers);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(
      (
        await request(
          '/api/activities',
          'POST',
          { ...activity, duration: 40 },
          undefined,
          token,
          headers,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          '/api/activities',
          'POST',
          { ...activity, visibility: 'public' },
          undefined,
          token,
        )
      ).status,
    ).toBe(403);
    const stored = await db
      .prepare("SELECT source, visibility FROM activities WHERE idempotency_key = 'first-run'")
      .first();
    expect(stored).toMatchObject({ source: 'agent', visibility: 'private' });
  });

  it('enforces agent scopes and blocks account, profile and event management', async () => {
    expect((await request('/api/activities', 'GET', undefined, undefined, token)).status).toBe(403);
    expect((await request('/api/events', 'GET', undefined, undefined, token)).status).toBe(403);
    expect((await request('/api/bootstrap', 'GET', undefined, undefined, token)).status).toBe(403);
    expect((await request('/api/me', 'PATCH', {}, undefined, token)).status).toBe(403);
    expect((await request('/api/tokens', 'POST', {}, undefined, token)).status).toBe(403);
    expect((await request('/api/events', 'POST', {}, undefined, token)).status).toBe(403);
    expect((await request('/api/profiles/alice', 'GET', undefined, undefined, token)).status).toBe(
      403,
    );
  });

  it('revokes agent access immediately', async () => {
    expect((await request(`/api/tokens/${tokenId}`, 'DELETE', undefined, bob)).status).toBe(404);
    expect((await request(`/api/tokens/${tokenId}`, 'DELETE', undefined, alice)).status).toBe(200);
    expect((await request('/api/activities', 'POST', activity, undefined, token)).status).toBe(401);
  });

  it('creates public events and counts the host as an attendee', async () => {
    const response = await request(
      '/api/events',
      'POST',
      {
        title: 'Friendly tennis',
        sport: 'Tennis',
        startsAt: '2098-01-01T09:00:00.000Z',
        location: 'City park',
        description: 'Bring a racket.',
        level: 'Beginners',
        capacity: 2,
      },
      alice,
    );
    expect(response.status).toBe(201);
    eventId = (await response.json<{ id: string }>()).id;
    const result = await (
      await request('/api/events', 'GET', undefined, alice)
    ).json<{ events: { attendees: number; joined: boolean }[] }>();
    expect(result.events[0]).toMatchObject({ attendees: 1, joined: true });
  });

  it('enforces capacity atomically, treats repeat joins as idempotent and allows leaving', async () => {
    const results = await Promise.all([
      request(`/api/events/${eventId}/join`, 'POST', { join: true }, bob),
      request(`/api/events/${eventId}/join`, 'POST', { join: true }, charlie),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? bob : charlie;
    expect(
      (await request(`/api/events/${eventId}/join`, 'POST', { join: true }, winner)).status,
    ).toBe(200);
    expect(
      (await request(`/api/events/${eventId}/join`, 'POST', { join: false }, winner)).status,
    ).toBe(200);
    expect(
      (await request(`/api/events/${eventId}/join`, 'POST', { join: false }, alice)).status,
    ).toBe(400);
  });

  it('allows only the host to cancel and removes cancelled events from discovery', async () => {
    expect((await request(`/api/events/${eventId}`, 'POST', {}, bob)).status).toBe(403);
    expect((await request(`/api/events/${eventId}`, 'POST', {}, alice)).status).toBe(200);
    expect((await request(`/api/events/${eventId}/join`, 'POST', { join: true }, bob)).status).toBe(
      404,
    );
    expect(await (await request('/api/events')).json()).toEqual({ events: [] });
  });

  it('fails explicitly when GitHub is not configured', async () => {
    const response = await request('/auth/github');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('not configured'),
    });
  });

  it('expires sessions and clears browser authentication on logout', async () => {
    await db.prepare("UPDATE sessions SET expires_at = '2000-01-01' WHERE user_id = 'bob'").run();
    expect((await request('/api/activities', 'GET', undefined, bob)).status).toBe(401);
    const response = await request('/api/logout', 'POST', {}, alice);
    expect(response.status).toBe(204);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await request('/api/activities', 'GET', undefined, alice)).status).toBe(401);
  });
});
