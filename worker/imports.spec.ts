import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workerModules } from './testing/bundle';
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

describe('Activity imports and Strava sync', () => {
  let runtime: Miniflare;
  let db: D1Database;
  const origin = 'http://localhost:8787';
  const sessions = { alice: 'a'.repeat(64), bob: 'b'.repeat(64) };
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const stravaCalls: string[] = [];
  let stravaActivities: Record<string, unknown>[] = [];
  let tokenExpiresAt = 4_102_444_800;
  let refreshFails: false | number = false;
  let tokenRevoked = false;
  let failActivityReads = false;
  let failActivityLists = false;
  /** Runs while Strava is answering a list request, to simulate a concurrent disconnect. */
  let duringList: (() => Promise<void>) | undefined;
  let deauthorizations = 0;
  let athleteId = 777;
  /** Activity IDs returned by each list response, to prove what Strava was asked for. */
  const listedIds: number[] = [];

  const request = (path: string, method = 'GET', data?: unknown, session?: string) =>
    runtime.dispatchFetch(`${origin}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Origin: origin,
        ...(session ? { Cookie: `dwm_session=${session}` } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });

  const run = (overrides: Record<string, unknown> = {}) => ({
    title: 'Lunch run',
    sport: 'Running',
    occurredAt: '2026-03-01T12:00:00.000Z',
    duration: 30,
    distance: 5.2,
    ...overrides,
  });

  const stateCookie = (response: Response) =>
    /dwm_strava_state=([^;]+)/.exec(response.headers.get('Set-Cookie')!)![1];

  async function connectAlice(): Promise<void> {
    const start = await request('/auth/strava', 'GET', undefined, sessions.alice);
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('Location')!);
    expect(location.origin).toBe('https://www.strava.com');
    expect(location.searchParams.get('scope')).toBe('activity:read_all');
    expect(location.searchParams.get('redirect_uri')).toBe(`${origin}/auth/strava/callback`);
    const state = location.searchParams.get('state')!;
    const stateCookie = /dwm_strava_state=([^;]+)/.exec(start.headers.get('Set-Cookie')!)![1];
    const callback = await runtime.dispatchFetch(
      `${origin}/auth/strava/callback?state=${state}&code=good-code&scope=read,activity:read_all`,
      {
        redirect: 'manual',
        headers: { Cookie: `dwm_session=${sessions.alice}; dwm_strava_state=${stateCookie}` },
      },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')).toBe(`${origin}/profile?strava=connected`);
  }

  beforeAll(async () => {
    const bundle = await workerModules();
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        ...bundle,
        compatibilityDate: '2026-11-03',
        bindings: {
          APP_URL: origin,
          STRAVA_CLIENT_ID: '123',
          STRAVA_CLIENT_SECRET: 'strava-secret',
          STRAVA_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'),
          STRAVA_WEBHOOK_VERIFY_TOKEN: 'verify-me',
        },
        d1Databases: ['DB'],
        r2Buckets: ['PHOTOS'],
        outboundService: async (outbound) => {
          const url = new URL(outbound.url);
          stravaCalls.push(`${outbound.method} ${url.pathname}${url.search}`);
          if (url.pathname === '/oauth/token') {
            const form = new URLSearchParams(await outbound.text());
            if (form.get('grant_type') === 'refresh_token' && refreshFails)
              return WorkerResponse.json({ message: 'Refresh failed' }, { status: refreshFails });
            if (form.get('client_secret') !== 'strava-secret')
              return WorkerResponse.json({}, { status: 401 });
            return WorkerResponse.json({
              access_token: `access-${form.get('grant_type')}`,
              refresh_token: 'refresh-token',
              expires_at: tokenExpiresAt,
              athlete: { id: athleteId },
            });
          }
          if (url.pathname === '/oauth/deauthorize') {
            deauthorizations++;
            return WorkerResponse.json({});
          }
          if (url.pathname.startsWith('/api/v3/') && tokenRevoked)
            return WorkerResponse.json({ message: 'Authorization Error' }, { status: 401 });
          if (url.pathname === '/api/v3/athlete') return WorkerResponse.json({ id: 777 });
          if (url.pathname === '/api/v3/athlete/activities' && failActivityLists)
            return new WorkerResponse('Unavailable', { status: 503 });
          if (url.pathname === '/api/v3/athlete/activities' && duringList) {
            const hook = duringList;
            duringList = undefined;
            await hook();
          }
          if (url.pathname === '/api/v3/athlete/activities') {
            const before = Number(url.searchParams.get('before') ?? Infinity);
            const after = Number(url.searchParams.get('after') ?? -Infinity);
            const page = Number(url.searchParams.get('page') ?? 1);
            const perPage = Number(url.searchParams.get('per_page') ?? 30);
            const start = (activity: Record<string, unknown>) =>
              Date.parse(String(activity['start_date'])) / 1000;
            // Like Strava: `before` pages run newest first, `after` pages oldest first.
            const matching = stravaActivities
              .filter((activity) => start(activity) < before && start(activity) > after)
              .sort((a, b) =>
                url.searchParams.has('before') ? start(b) - start(a) : start(a) - start(b),
              );
            const pageItems = matching.slice((page - 1) * perPage, page * perPage);
            listedIds.push(...pageItems.map((activity) => Number(activity['id'])));
            return WorkerResponse.json(pageItems);
          }
          const single = /^\/api\/v3\/activities\/(\d+)$/.exec(url.pathname);
          if (single && failActivityReads)
            return new WorkerResponse('Unavailable', { status: 503 });
          if (single) {
            const found = stravaActivities.find((activity) => String(activity['id']) === single[1]);
            return found ? WorkerResponse.json(found) : new WorkerResponse(null, { status: 404 });
          }
          return new WorkerResponse('Unexpected outbound request', { status: 500 });
        },
      }),
    );
    db = (await runtime.getD1Database('DB')) as unknown as D1Database;
    for (const name of (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort())
      await db.exec(
        (await readFile(`migrations/${name}`, 'utf8')).replace(/--[^\n]*/g, '').replace(/\n/g, ' '),
      );
    for (const [id, githubId] of [
      ['alice', 1],
      ['bob', 2],
    ] as const) {
      await db
        .prepare('INSERT INTO users (id, github_id, username, name) VALUES (?, ?, ?, ?)')
        .bind(id, githubId, id, id)
        .run();
      await db
        .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(hash(sessions[id]), id, '2099-01-01T00:00:00.000Z')
        .run();
    }
  });

  afterAll(async () => runtime?.dispose());

  beforeEach(async () => {
    stravaCalls.length = 0;
    stravaActivities = [];
    tokenExpiresAt = 4_102_444_800;
    refreshFails = false;
    tokenRevoked = false;
    failActivityLists = false;
    duringList = undefined;
    failActivityReads = false;
    deauthorizations = 0;
    athleteId = 777;
    listedIds.length = 0;
    await db.exec(
      'DELETE FROM activities; DELETE FROM strava_connections; DELETE FROM rate_limits; DELETE FROM strava_webhook_events; DELETE FROM strava_deleted_activities;',
    );
  });

  it('imports file summaries as private activities and skips duplicates across sources', async () => {
    const first = await request(
      '/api/imports',
      'POST',
      {
        source: 'garmin',
        activities: [run(), run({ occurredAt: '2026-03-02T12:00:00.000Z', duration: 0.2 })],
      },
      sessions.alice,
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ imported: 1, duplicates: 0, invalid: 1 });

    // The same run recorded by the phone starts 40 seconds later.
    const second = await request(
      '/api/imports',
      'POST',
      { source: 'apple-health', activities: [run({ occurredAt: '2026-03-01T12:00:40.000Z' })] },
      sessions.alice,
    );
    expect(await second.json()).toMatchObject({ imported: 0, duplicates: 1 });

    const stored = await db
      .prepare(
        'SELECT visibility, notes, import_source AS source FROM activities WHERE user_id = ?',
      )
      .bind('alice')
      .all();
    expect(stored.results).toEqual([{ visibility: 'private', notes: '', source: 'garmin' }]);

    const listed = (await (
      await request('/api/activities', 'GET', undefined, sessions.alice)
    ).json()) as { activities: { importSource: string }[] };
    expect(listed.activities[0].importSource).toBe('garmin');
  });

  it('rejects the strava source, oversized batches and signed-out imports', async () => {
    const strava = await request(
      '/api/imports',
      'POST',
      { source: 'strava', activities: [run()] },
      sessions.alice,
    );
    expect(strava.status).toBe(400);
    const tooMany = await request(
      '/api/imports',
      'POST',
      { source: 'file', activities: Array.from({ length: 201 }, () => run()) },
      sessions.alice,
    );
    expect(tooMany.status).toBe(400);
    expect(
      (await request('/api/imports', 'POST', { source: 'file', activities: [run()] })).status,
    ).toBe(401);
  });

  it('connects Strava, backfills history and keeps Strava imports private', async () => {
    const status = await request('/api/strava', 'GET', undefined, sessions.alice);
    expect(await status.json()).toEqual({ configured: true, connected: false });
    await connectAlice();

    const row = await db
      .prepare('SELECT athlete_id, encrypted_tokens FROM strava_connections WHERE user_id = ?')
      .bind('alice')
      .first<{ athlete_id: number; encrypted_tokens: string }>();
    expect(row?.athlete_id).toBe(777);
    expect(row?.encrypted_tokens).not.toContain('refresh-token');

    stravaActivities = [
      {
        id: 1001,
        name: 'Morning Run',
        sport_type: 'TrailRun',
        start_date: '2025-06-01T06:00:00Z',
        moving_time: 1800,
        elapsed_time: 2000,
        distance: 6012.4,
        map: { summary_polyline: 'secret-route' },
      },
      {
        id: 1002,
        name: 'Commute',
        sport_type: 'EBikeRide',
        start_date: '2025-06-02T08:00:00Z',
        moving_time: 1200,
        distance: 9000,
      },
    ];
    const sync = await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    expect(sync.status).toBe(200);
    expect(await sync.json()).toMatchObject({ imported: 2, historyComplete: true });

    const stored = await db
      .prepare(
        `SELECT id, title, sport, duration, distance, visibility, external_id AS externalId
        FROM activities WHERE user_id = 'alice' ORDER BY occurred_at`,
      )
      .all<Record<string, unknown>>();
    expect(stored.results.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        title: 'Morning Run',
        sport: 'Running',
        duration: 30,
        distance: 6.012,
        visibility: 'private',
        externalId: '1001',
      },
      {
        title: 'Commute',
        sport: 'Cycling',
        duration: 20,
        distance: 9,
        visibility: 'private',
        externalId: '1002',
      },
    ]);
    expect(JSON.stringify(stored.results)).not.toContain('secret-route');

    const again = await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    expect(await again.json()).toMatchObject({ imported: 0 });

    const id = String(stored.results[0]['id']);
    const publish = await request(
      `/api/activities/${id}`,
      'PATCH',
      { visibility: 'public' },
      sessions.alice,
    );
    expect(publish.status).toBe(400);
    expect(await publish.json()).toMatchObject({ error: expect.stringContaining('Strava') });
    const bulk = await request(
      '/api/activities/bulk-visibility',
      'PATCH',
      { ids: [id], visibility: 'public' },
      sessions.alice,
    );
    expect(bulk.status).toBe(400);
  });

  it('refuses to link one Strava athlete to two profiles', async () => {
    await connectAlice();
    const start = await request('/auth/strava', 'GET', undefined, sessions.bob);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
    const callback = await runtime.dispatchFetch(
      `${origin}/auth/strava/callback?state=${state}&code=good-code&scope=activity:read_all`,
      {
        redirect: 'manual',
        headers: { Cookie: `dwm_session=${sessions.bob}; dwm_strava_state=${stateCookie(start)}` },
      },
    );
    const location = new URL(callback.headers.get('Location')!);
    expect(location.searchParams.get('strava')).toBe('error');
    expect(location.searchParams.get('reason')).toContain('already connected');
  });

  it('rejects a callback without the activity scope or with a forged state', async () => {
    const start = await request('/auth/strava', 'GET', undefined, sessions.alice);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
    const narrow = await runtime.dispatchFetch(
      `${origin}/auth/strava/callback?state=${state}&code=good-code&scope=read`,
      {
        redirect: 'manual',
        headers: {
          Cookie: `dwm_session=${sessions.alice}; dwm_strava_state=${stateCookie(start)}`,
        },
      },
    );
    expect(new URL(narrow.headers.get('Location')!).searchParams.get('reason')).toContain(
      'did not grant',
    );
    const forged = await runtime.dispatchFetch(
      `${origin}/auth/strava/callback?state=forged&code=good-code&scope=activity:read_all`,
      {
        redirect: 'manual',
        headers: { Cookie: `dwm_session=${sessions.alice}; dwm_strava_state=${state}` },
      },
    );
    expect(new URL(forged.headers.get('Location')!).searchParams.get('strava')).toBe('error');
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM strava_connections').first('count'),
    ).toBe(0);
  });

  it('refreshes expired tokens and forgets connections whose refresh is revoked', async () => {
    tokenExpiresAt = 1;
    await connectAlice();
    await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    expect(stravaCalls.filter((call) => call === 'POST /oauth/token')).toHaveLength(2);

    tokenExpiresAt = 1;
    await connectAlice();
    refreshFails = 500;
    const temporary = await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    expect(temporary.status).toBe(502);
    expect(
      await (await request('/api/strava', 'GET', undefined, sessions.alice)).json(),
    ).toMatchObject({ connected: true });

    await db
      .prepare(
        `INSERT INTO activities (id, user_id, title, sport, occurred_at, duration, visibility, source,
          payload_hash, import_source, external_id, fetched_at)
        VALUES ('revoked-run', 'alice', 'Run', 'Running', '2026-01-01T07:00:00.000Z', 30, 'private',
          'web', 'x', 'strava', '9', ?)`,
      )
      .bind(new Date().toISOString())
      .run();
    refreshFails = 400;
    const revoked = await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    expect(revoked.status).toBe(409);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM activities').first('count')).toBe(0);
    expect(await (await request('/api/strava', 'GET', undefined, sessions.alice)).json()).toEqual({
      configured: true,
      connected: false,
    });
  });

  it('verifies the webhook subscription and applies create, delete and deauthorize events', async () => {
    const challenge = await runtime.dispatchFetch(
      `${origin}/webhooks/strava?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc`,
    );
    expect(await challenge.json()).toEqual({ 'hub.challenge': 'abc' });
    const wrong = await runtime.dispatchFetch(
      `${origin}/webhooks/strava?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc`,
    );
    expect(wrong.status).toBe(403);

    await connectAlice();
    stravaActivities = [
      {
        id: 2001,
        name: 'Swim',
        sport_type: 'Swim',
        start_date: '2026-02-01T07:00:00Z',
        moving_time: 2400,
        distance: 1500,
      },
    ];
    const event = (body: Record<string, unknown>) =>
      runtime.dispatchFetch(`${origin}/webhooks/strava`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: 777, subscription_id: 1, ...body }),
      });
    const waitFor = async (check: () => Promise<boolean>) => {
      for (let attempt = 0; attempt < 50 && !(await check()); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 20));
    };
    const count = async () =>
      Number(await db.prepare(`SELECT COUNT(*) AS count FROM activities`).first('count'));
    const queued = async () =>
      Number(
        await db.prepare('SELECT COUNT(*) AS count FROM strava_webhook_events').first('count'),
      );

    expect(
      (await event({ object_type: 'activity', object_id: 2001, aspect_type: 'create' })).status,
    ).toBe(200);
    await waitFor(async () => (await count()) === 1);
    expect(await count()).toBe(1);

    // A delete event for an activity Strava still returns is ignored.
    await event({ object_type: 'activity', object_id: 2001, aspect_type: 'delete' });
    await waitFor(async () => (await queued()) === 0);
    expect(await count()).toBe(1);

    stravaActivities = [];
    await event({ object_type: 'activity', object_id: 2001, aspect_type: 'delete' });
    await waitFor(async () => (await count()) === 0);
    expect(await count()).toBe(0);

    // A deauthorization event is ignored while Strava still accepts the token.
    const deauthorize = () =>
      event({
        object_type: 'athlete',
        object_id: 777,
        aspect_type: 'update',
        updates: { authorized: 'false' },
      });
    await deauthorize();
    await waitFor(async () => (await queued()) === 0);
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM strava_connections').first('count'),
    ).toBe(1);

    tokenRevoked = true;
    await deauthorize();
    await waitFor(
      async () =>
        Number(
          await db.prepare('SELECT COUNT(*) AS count FROM strava_connections').first('count'),
        ) === 0,
    );
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM strava_connections').first('count'),
    ).toBe(0);
  });

  it('stores webhook events and retries them after a transient failure', async () => {
    await connectAlice();
    stravaActivities = [
      { id: 4001, sport_type: 'Run', start_date: '2026-02-03T07:00:00Z', moving_time: 1500 },
    ];
    failActivityReads = true;
    const response = await runtime.dispatchFetch(`${origin}/webhooks/strava`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object_type: 'activity',
        object_id: 4001,
        aspect_type: 'create',
        owner_id: 777,
      }),
    });
    expect(response.status).toBe(200);
    const attempts = async () =>
      Number(await db.prepare('SELECT attempts FROM strava_webhook_events').first('attempts'));
    for (let attempt = 0; attempt < 50 && (await attempts()) !== 1; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await attempts()).toBe(1);

    failActivityReads = false;
    await db.exec(`UPDATE strava_webhook_events SET next_attempt_at = '2000-01-01T00:00:00.000Z'`);
    await (await runtime.getWorker()).scheduled();
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM strava_webhook_events').first('count'),
    ).toBe(0);
    expect(await db.prepare('SELECT external_id FROM activities').first('external_id')).toBe(
      '4001',
    );

    // Events for athletes with no connection are acknowledged but not stored.
    await runtime.dispatchFetch(`${origin}/webhooks/strava`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object_type: 'activity',
        object_id: 1,
        aspect_type: 'create',
        owner_id: 9,
      }),
    });
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM strava_webhook_events').first('count'),
    ).toBe(0);
  });

  it('backfills long histories across several sync requests', async () => {
    await connectAlice();
    stravaActivities = Array.from({ length: 450 }, (_, index) => ({
      id: 10_000 + index,
      sport_type: index % 2 ? 'Ride' : 'Run',
      start_date: new Date(Date.UTC(2025, 0, 1) - index * 86_400_000).toISOString(),
      moving_time: 1800,
    }));
    const first = (await (
      await request('/api/strava/sync', 'POST', undefined, sessions.alice)
    ).json()) as { imported: number; historyComplete: boolean };
    expect(first).toMatchObject({ imported: 400, historyComplete: false });
    const second = (await (
      await request('/api/strava/sync', 'POST', undefined, sessions.alice)
    ).json()) as { imported: number; historyComplete: boolean };
    expect(second).toMatchObject({ imported: 50, historyComplete: true });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM activities').first('count')).toBe(450);
  });

  it('rejects a Strava callback completed by a different signed-in user', async () => {
    const start = await request('/auth/strava', 'GET', undefined, sessions.alice);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
    const cookieValue = /dwm_strava_state=([^;]+)/.exec(start.headers.get('Set-Cookie')!)![1];
    const callback = await runtime.dispatchFetch(
      `${origin}/auth/strava/callback?state=${state}&code=good-code&scope=activity:read_all`,
      {
        redirect: 'manual',
        headers: { Cookie: `dwm_session=${sessions.bob}; dwm_strava_state=${cookieValue}` },
      },
    );
    expect(new URL(callback.headers.get('Location')!).searchParams.get('strava')).toBe('error');
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM strava_connections').first('count'),
    ).toBe(0);
  });

  it('disconnects Strava and removes its imports but keeps other imports', async () => {
    await connectAlice();
    stravaActivities = [
      { id: 3001, sport_type: 'Walk', start_date: '2026-01-05T10:00:00Z', moving_time: 900 },
    ];
    await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    await request(
      '/api/imports',
      'POST',
      { source: 'garmin', activities: [run()] },
      sessions.alice,
    );
    const stravaId = await db
      .prepare(`SELECT id FROM activities WHERE import_source = 'strava'`)
      .first<string>('id');
    await db
      .prepare(
        `INSERT INTO activity_kudos (activity_id, actor_id, created_at) VALUES (?, 'alice', ?)`,
      )
      .bind(stravaId, new Date().toISOString())
      .run();

    const disconnect = await request('/api/strava', 'DELETE', undefined, sessions.alice);
    expect(await disconnect.json()).toEqual({ ok: true, removed: 1 });
    expect(deauthorizations).toBe(1);
    const left = await db.prepare('SELECT import_source AS source FROM activities').all();
    expect(left.results).toEqual([{ source: 'garmin' }]);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM activity_kudos').first('count')).toBe(0);
  });

  it('re-fetches Strava history on cron and purges imports not re-confirmed in 7 days', async () => {
    await connectAlice();
    stravaActivities = [
      {
        id: 5001,
        name: 'Kept run',
        sport_type: 'Run',
        start_date: '2026-01-10T07:00:00Z',
        moving_time: 1800,
      },
      {
        id: 5002,
        name: 'Deleted ride',
        sport_type: 'Ride',
        start_date: '2026-01-11T07:00:00Z',
        moving_time: 3600,
      },
    ];
    await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    await request(
      '/api/imports',
      'POST',
      { source: 'garmin', activities: [run()] },
      sessions.alice,
    );
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    await db
      .prepare(`UPDATE activities SET fetched_at = ? WHERE import_source = 'strava'`)
      .bind(eightDaysAgo)
      .run();
    await db
      .prepare('UPDATE strava_connections SET refreshed_at = ?')
      .bind(new Date(Date.now() - 5 * 86_400_000).toISOString())
      .run();
    // The ride was deleted on Strava and the run was renamed.
    stravaActivities = [{ ...stravaActivities[0], name: 'Renamed run' }];

    await (await runtime.getWorker()).scheduled();

    const left = await db
      .prepare('SELECT title, import_source AS source FROM activities ORDER BY occurred_at')
      .all();
    expect(left.results).toEqual([
      { title: 'Renamed run', source: 'strava' },
      { title: 'Lunch run', source: 'garmin' },
    ]);
    const connection = await db
      .prepare('SELECT refresh_cursor, refreshed_at FROM strava_connections')
      .first<{ refresh_cursor: number | null; refreshed_at: string }>();
    expect(connection?.refresh_cursor).toBeNull();
    expect(Date.parse(connection!.refreshed_at)).toBeGreaterThan(Date.now() - 60_000);

    // Without a connection nothing re-confirms Strava data, so it is purged after 7 days.
    await db.exec('DELETE FROM strava_connections');
    await db
      .prepare(`UPDATE activities SET fetched_at = ? WHERE import_source = 'strava'`)
      .bind(eightDaysAgo)
      .run();
    await (await runtime.getWorker()).scheduled();
    expect(
      await db
        .prepare(`SELECT COUNT(*) AS count FROM activities WHERE import_source = 'strava'`)
        .first('count'),
    ).toBe(0);
  });

  it('drops pages fetched for a connection that was removed mid-sync', async () => {
    await connectAlice();
    stravaActivities = [
      { id: 6001, sport_type: 'Run', start_date: '2026-01-20T07:00:00Z', moving_time: 1800 },
    ];
    // The athlete disconnects while Strava is still answering the sync's list request.
    let disconnected = false;
    duringList = async () => {
      await db.exec('DELETE FROM strava_connections');
      disconnected = true;
    };
    const sync = await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    expect(disconnected).toBe(true);
    expect(listedIds).toContain(6001);
    expect(sync.status).toBe(200);
    expect(await sync.json()).toMatchObject({ imported: 0, duplicates: 1 });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM activities').first('count')).toBe(0);
  });

  it('does not re-import a Strava activity deleted here until Strava is reconnected', async () => {
    await connectAlice();
    stravaActivities = [
      { id: 7001, sport_type: 'Run', start_date: '2026-01-21T07:00:00Z', moving_time: 1800 },
    ];
    await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    const id = await db.prepare('SELECT id FROM activities').first<string>('id');
    expect(
      (await request(`/api/activities/${id}`, 'DELETE', undefined, sessions.alice)).status,
    ).toBe(200);

    await db.exec(`UPDATE strava_connections SET refreshed_at = '2000-01-01T00:00:00.000Z'`);
    listedIds.length = 0;
    await (await runtime.getWorker()).scheduled();
    expect(listedIds).toContain(7001);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM activities').first('count')).toBe(0);

    await request('/api/strava', 'DELETE', undefined, sessions.alice);
    await connectAlice();
    await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM activities').first('count')).toBe(1);
  });

  it('keeps the stored copy when a Strava edit would overlap another activity', async () => {
    await connectAlice();
    stravaActivities = [
      {
        id: 8001,
        name: 'Ride',
        sport_type: 'Ride',
        start_date: '2026-01-22T07:00:00Z',
        moving_time: 1800,
      },
    ];
    await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    await request(
      '/api/imports',
      'POST',
      { source: 'garmin', activities: [run({ occurredAt: '2026-01-23T07:00:00.000Z' })] },
      sessions.alice,
    );
    // On Strava the ride is changed into a run at the same time as the Garmin run.
    stravaActivities = [
      {
        id: 8001,
        name: 'Run',
        sport_type: 'Run',
        start_date: '2026-01-23T07:00:30Z',
        moving_time: 1800,
      },
    ];
    await db.exec(
      `UPDATE activities SET fetched_at = '2000-01-01T00:00:00.000Z' WHERE import_source = 'strava'`,
    );
    await db.exec(`UPDATE strava_connections SET refreshed_at = '2000-01-01T00:00:00.000Z'`);
    await (await runtime.getWorker()).scheduled();
    const strava = await db
      .prepare(`SELECT title, sport, fetched_at FROM activities WHERE import_source = 'strava'`)
      .first<{ title: string; sport: string; fetched_at: string }>();
    expect(strava).toMatchObject({ title: 'Ride', sport: 'Cycling' });
    expect(Date.parse(strava!.fetched_at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('backs off a failing re-fetch so healthy connections are not crowded out', async () => {
    await connectAlice();
    await db.exec(`UPDATE strava_connections SET refreshed_at = '2000-01-01T00:00:00.000Z'`);
    failActivityLists = true;
    await (await runtime.getWorker()).scheduled();
    const row = await db
      .prepare('SELECT refresh_retry_at, refreshed_at FROM strava_connections')
      .first<{ refresh_retry_at: string; refreshed_at: string }>();
    expect(Date.parse(row!.refresh_retry_at)).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect(row!.refreshed_at).toBe('2000-01-01T00:00:00.000Z');

    // While backing off it is not retried, even though it is overdue.
    failActivityLists = false;
    stravaCalls.length = 0;
    await (await runtime.getWorker()).scheduled();
    expect(stravaCalls.some((call) => call.includes('/athlete/activities'))).toBe(false);
  });

  it("switching Strava athletes removes the previous athlete's imports in one step", async () => {
    await connectAlice();
    stravaActivities = [
      { id: 9001, sport_type: 'Run', start_date: '2026-01-24T07:00:00Z', moving_time: 1800 },
    ];
    await request('/api/strava/sync', 'POST', undefined, sessions.alice);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM activities').first('count')).toBe(1);

    athleteId = 888;
    await connectAlice();
    expect(await db.prepare('SELECT athlete_id FROM strava_connections').first('athlete_id')).toBe(
      888,
    );
    expect(await db.prepare('SELECT COUNT(*) AS count FROM activities').first('count')).toBe(0);
  });

  it('reports out-of-range dates as invalid without failing the rest of the batch', async () => {
    const response = await request(
      '/api/imports',
      'POST',
      {
        source: 'file',
        activities: [run(), run({ occurredAt: '-271821-04-20T00:00:00.000Z' })],
      },
      sessions.alice,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 1, invalid: 1 });
  });

  it('includes the Strava connection in the data export without tokens', async () => {
    await connectAlice();
    const exported = await request('/api/account/export', 'GET', undefined, sessions.alice);
    const text = await exported.text();
    const data = JSON.parse(text) as { stravaConnection: Record<string, unknown>[] };
    expect(data.stravaConnection).toEqual([
      expect.objectContaining({ athlete_id: 777, scope: 'read,activity:read_all' }),
    ]);
    expect(text).not.toMatch(/encrypted_tokens|refresh-token|access-authorization_code/);
  });

  it('revokes Strava when the account is deleted', async () => {
    await connectAlice();
    const deleted = await request(
      '/api/account',
      'DELETE',
      { confirmation: 'DELETE' },
      sessions.alice,
    );
    expect(deleted.ok).toBe(true);
    expect(deauthorizations).toBe(1);
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM strava_connections').first('count'),
    ).toBe(0);
  });
});
