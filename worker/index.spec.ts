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

  function mcpRequest(
    method: string,
    params: Record<string, unknown> = {},
    bearer?: string,
    protocolVersion = '2026-07-28',
    extra: Record<string, string> = {},
  ) {
    return request(
      '/mcp',
      'POST',
      {
        jsonrpc: '2.0',
        id: 'mcp-test',
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': protocolVersion,
            'io.modelcontextprotocol/clientInfo': { name: 'Worker test', version: '1.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      undefined,
      bearer,
      {
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': protocolVersion,
        'Mcp-Method': method,
        ...(typeof params['name'] === 'string' ? { 'Mcp-Name': params['name'] } : {}),
        ...extra,
      },
    );
  }

  const photo = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    0x00,
    0x0f,
    ...Array.from('Exif\0\0GPS:52N', (char) => char.charCodeAt(0)),
    0xff,
    0xda,
    0x00,
    0x04,
    0x01,
    0x02,
    0x11,
    0x22,
    0xff,
    0xd9,
  ]);
  const upload = (id: string, data: Uint8Array, session?: string, bearer?: string) =>
    runtime.dispatchFetch(`${origin}/api/activities/${id}/photo`, {
      method: 'PUT',
      headers: {
        Origin: origin,
        'Content-Type': 'image/jpeg',
        ...(session ? { Cookie: `dwm_session=${session}` } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: data,
    });
  const storedPhotos = async () =>
    (await (await runtime.getR2Bucket('PHOTOS')).list()).objects.length;

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
        r2Buckets: ['PHOTOS'],
        bindings: { APP_URL: origin },
      }),
    );
    db = await runtime.getD1Database('DB');
    const migration = (
      await Promise.all(
        ['0001_initial.sql', '0002_activity_photos.sql'].map((file) =>
          readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'),
        ),
      )
    ).join(';');
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

  it('changes visibility for a batch of owned activities atomically', async () => {
    const secondResponse = await request('/api/activities', 'POST', activity, alice);
    const secondId = (await secondResponse.json<{ id: string }>()).id;
    const foreignResponse = await request('/api/activities', 'POST', activity, bob);
    const foreignId = (await foreignResponse.json<{ id: string }>()).id;

    expect(
      (
        await request(
          '/api/activities/bulk-visibility',
          'PATCH',
          { ids: [activityId, foreignId], visibility: 'public' },
          alice,
        )
      ).status,
    ).toBe(404);
    const unchanged = await (
      await request('/api/activities', 'GET', undefined, alice)
    ).json<{ activities: { visibility: string }[] }>();
    expect(unchanged.activities.every((item) => item.visibility === 'private')).toBe(true);
    expect(
      (
        await request(
          '/api/activities/bulk-visibility',
          'PATCH',
          { ids: [], visibility: 'public' },
          alice,
        )
      ).status,
    ).toBe(400);

    const response = await request(
      '/api/activities/bulk-visibility',
      'PATCH',
      { ids: [activityId, secondId], visibility: 'public' },
      alice,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 2 });
    const owned = await (
      await request('/api/activities', 'GET', undefined, alice)
    ).json<{ activities: { id: string; visibility: string }[] }>();
    expect(owned.activities).toHaveLength(2);
    expect(owned.activities.every((item) => item.visibility === 'public')).toBe(true);

    await request(
      '/api/activities/bulk-visibility',
      'PATCH',
      { ids: [activityId, secondId], visibility: 'private' },
      alice,
    );
    await request(`/api/activities/${secondId}`, 'DELETE', undefined, alice);
    await request(`/api/activities/${foreignId}`, 'DELETE', undefined, bob);
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

  it('stores activity photos without metadata and serves them only to allowed viewers', async () => {
    expect((await upload(activityId, photo, bob)).status).toBe(404);
    expect((await upload(activityId, photo)).status).toBe(401);
    expect((await upload(activityId, new TextEncoder().encode('<svg/>'), alice)).status).toBe(400);
    expect((await upload(activityId, new Uint8Array(5 * 1024 * 1024 + 1), alice)).status).toBe(413);
    const response = await upload(activityId, photo, alice);
    expect(response.status).toBe(200);
    const { photo: url } = await response.json<{ photo: string }>();
    expect(url).toMatch(new RegExp(`^/api/activities/${activityId}/photo\\?v=`));
    const own = await (
      await request('/api/bootstrap', 'GET', undefined, alice)
    ).json<{ activities: { photo: string }[] }>();
    expect(own.activities[0].photo).toBe(url);
    const served = await request(url, 'GET', undefined, alice);
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('image/jpeg');
    expect(served.headers.get('Cache-Control')).toContain('private');
    const image = new Uint8Array(await served.arrayBuffer());
    expect(String.fromCharCode(...image)).not.toContain('GPS');
    expect(Array.from(image.slice(-2))).toEqual([0xff, 0xd9]);
    expect((await request(url)).status).toBe(404);
    expect((await request(url, 'GET', undefined, bob)).status).toBe(404);
    expect((await upload(activityId, photo, alice)).status).toBe(200);
    expect(await storedPhotos()).toBe(1);
    expect(
      (await request(`/api/activities/${activityId}/photo`, 'DELETE', undefined, alice)).status,
    ).toBe(200);
    expect(await storedPhotos()).toBe(0);
    expect((await request(url, 'GET', undefined, alice)).status).toBe(404);
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
    const agentActivity = (await db
      .prepare("SELECT id FROM activities WHERE idempotency_key = 'first-run'")
      .first<{ id: string }>())!.id;
    expect((await upload(agentActivity, photo, undefined, token)).status).toBe(200);
    expect((await upload(activityId, photo, undefined, token)).status).toBe(403);
    expect(await storedPhotos()).toBe(1);
    expect(
      (await request(`/api/activities/${agentActivity}`, 'DELETE', undefined, alice)).status,
    ).toBe(200);
    expect(await storedPhotos()).toBe(0);
  });

  it('serves the current stateless MCP protocol through scoped agent tokens', async () => {
    const tokenResponse = await request(
      '/api/tokens',
      'POST',
      {
        name: 'MCP integration',
        scopes: ['activities:read', 'activities:write', 'events:read'],
      },
      alice,
    );
    expect(tokenResponse.status).toBe(201);
    const mcpToken = await tokenResponse.json<{ id: string; token: string }>();

    const discovery = await mcpRequest('server/discover', {}, mcpToken.token);
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({
      result: {
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'devs-who-move' } },
      },
    });

    const listing = await mcpRequest('tools/list', {}, mcpToken.token);
    const availableTools = await listing.json<{
      result: { tools: { name: string }[]; cacheScope: string; ttlMs: number };
    }>();
    expect(availableTools.result.tools.map(({ name }) => name)).toEqual([
      'list_activities',
      'create_activity',
      'list_upcoming_events',
    ]);
    expect(availableTools.result).toMatchObject({ cacheScope: 'private', ttlMs: 60_000 });

    const activityArgs = {
      title: 'MCP activity',
      sport: 'Running',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      duration: 25,
      distance: 4,
      idempotencyKey: 'mcp-import-1',
    };
    const created = await mcpRequest(
      'tools/call',
      { name: 'create_activity', arguments: activityArgs },
      mcpToken.token,
    );
    const createdResult = await created.json<{
      result: { structuredContent: { id: string; visibility: string; source: string } };
    }>();
    expect(createdResult.result.structuredContent).toMatchObject({
      visibility: 'private',
      source: 'agent',
    });

    const invalidActivity = await mcpRequest(
      'tools/call',
      {
        name: 'create_activity',
        arguments: {
          title: 'Invalid MCP activity',
          sport: 'Running',
          occurredAt: new Date(Date.now() - 60_000).toISOString(),
          duration: 0,
        },
      },
      mcpToken.token,
    );
    expect(invalidActivity.status).toBe(200);
    expect(await invalidActivity.json()).toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: 'Duration in minutes must be between 1 and 1440.' },
      },
    });

    const listedActivities = await mcpRequest(
      'tools/call',
      { name: 'list_activities' },
      mcpToken.token,
    );
    const activityResult = await listedActivities.json<{
      result: { structuredContent: { activities: { id: string; title: string }[] } };
    }>();
    expect(activityResult.result.structuredContent.activities).toContainEqual(
      expect.objectContaining({
        id: createdResult.result.structuredContent.id,
        title: 'MCP activity',
      }),
    );

    const writeOnly = await mcpRequest('tools/list', {}, token);
    expect(
      (await writeOnly.json<{ result: { tools: { name: string }[] } }>()).result.tools.map(
        ({ name }) => name,
      ),
    ).toEqual(['create_activity']);

    const unsupportedVersion = await mcpRequest('tools/list', {}, mcpToken.token, '1900-01-01');
    expect(unsupportedVersion.status).toBe(400);
    expect(await unsupportedVersion.json()).toMatchObject({
      error: { code: -32022, data: { supported: ['2026-07-28'] } },
    });

    const badHeader = await mcpRequest('tools/list', {}, mcpToken.token, '2026-07-28', {
      'Mcp-Method': 'tools/call',
    });
    expect(badHeader.status).toBe(400);
    expect(await badHeader.json()).toMatchObject({ error: { code: -32020 } });

    const wrongOrigin = await mcpRequest('tools/list', {}, mcpToken.token, '2026-07-28', {
      Origin: 'https://other.example',
    });
    expect(wrongOrigin.status).toBe(403);

    const unauthenticated = await mcpRequest('server/discover');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('WWW-Authenticate')).toContain('Bearer');

    await request(`/api/tokens/${mcpToken.id}`, 'DELETE', undefined, alice);
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

  it('lets only the host edit an event and never below current attendance', async () => {
    const edit = {
      title: 'Doubles tennis',
      sport: 'Tennis',
      startsAt: '2098-01-02T10:00:00.000Z',
      location: 'North courts',
      description: 'Rackets available.',
      level: 'Intermediate',
      capacity: 5,
    };
    expect((await request(`/api/events/${eventId}`, 'PATCH', edit, bob)).status).toBe(403);
    expect(
      (await request(`/api/events/${eventId}`, 'PATCH', edit, undefined, 'dwm_x')).status,
    ).toBe(401);
    expect(
      (
        await request(
          `/api/events/${eventId}`,
          'PATCH',
          { ...edit, startsAt: '2001-01-01T00:00:00.000Z' },
          alice,
        )
      ).status,
    ).toBe(400);
    expect((await request(`/api/events/${eventId}`, 'PATCH', edit, alice)).status).toBe(200);
    for (const person of [bob, charlie])
      expect(
        (await request(`/api/events/${eventId}/join`, 'POST', { join: true }, person)).status,
      ).toBe(200);
    const tooSmall = await request(
      `/api/events/${eventId}`,
      'PATCH',
      { ...edit, capacity: 2 },
      alice,
    );
    expect(tooSmall.status).toBe(409);
    expect(await tooSmall.json()).toMatchObject({ error: expect.stringContaining('3 people') });
    const { events } = await (
      await request('/api/events')
    ).json<{ events: Record<string, unknown>[] }>();
    expect(events[0]).toMatchObject({ ...edit, attendees: 3, joined: false });
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
