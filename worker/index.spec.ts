import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workerModules } from './testing/bundle';
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { ATPROTO_OAUTH_SCOPE } from './atproto';

describe('Worker with real D1 storage', () => {
  let runtime: Miniflare;
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
  const origin = 'http://localhost:8787';
  const alice = 'a'.repeat(64);
  const bob = 'b'.repeat(64);
  const charlie = 'c'.repeat(64);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const atprotoSigningKey = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64');
  const atprotoSessionKey = Buffer.alloc(32, 7).toString('base64');
  const publishedAtprotoRecords: Record<string, unknown>[] = [];
  let remoteAtprotoEvents: { uri: string; cid: string; value: Record<string, unknown> }[] = [];
  let failAtprotoEventUpdate = false;
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  function encryptedAtprotoSession(did: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(atprotoSessionKey, 'base64'), iv);
    cipher.setAAD(Buffer.from(`session:${did}`));
    const ciphertext = Buffer.concat([
      cipher.update(
        JSON.stringify({
          dpopJwk: privateKey.export({ format: 'jwk' }),
          authMethod: { method: 'none' },
          tokenSet: {
            sub: did,
            iss: 'https://auth.example',
            aud: 'https://pds.example',
            scope: ATPROTO_OAUTH_SCOPE,
            token_type: 'DPoP',
            access_token: 'test-access-token',
            expires_at: '2099-01-01T00:00:00.000Z',
          },
        }),
      ),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return `${iv.toString('base64')}.${ciphertext.toString('base64')}`;
  }
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
    const bundled = await workerModules();
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        ...bundled,
        compatibilityDate: '2026-11-03',
        d1Databases: ['DB'],
        r2Buckets: ['PHOTOS'],
        serviceBindings: {
          ASSETS: async () =>
            new WorkerResponse(
              '<!doctype html><html><head><title>Devs Who Move</title><meta name="description" content="Default" /></head><body><app-root></app-root></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            ),
        },
        bindings: {
          APP_URL: origin,
          ATPROTO_OAUTH_PRIVATE_KEY: atprotoSigningKey,
          ATPROTO_SESSION_KEY: atprotoSessionKey,
        },
        outboundService: async (request) => {
          const url = new URL(request.url);
          if (
            url.origin === 'https://pds.example' &&
            url.pathname.endsWith('/com.atproto.repo.describeRepo')
          )
            return WorkerResponse.json({
              did: url.searchParams.get('repo'),
              didDoc: {},
              handle: 'conference.example',
              collections: [],
              handleIsCorrect: true,
            });
          if (
            url.origin === 'https://pds.example' &&
            url.pathname.endsWith('/com.atproto.repo.listRecords')
          )
            return WorkerResponse.json({
              records:
                url.searchParams.get('collection') === 'dev.devswhorun.event'
                  ? remoteAtprotoEvents
                  : [],
            });
          if (request.url === 'https://pds.example/xrpc/com.atproto.repo.putRecord') {
            if (failAtprotoEventUpdate)
              return WorkerResponse.json(
                { error: 'InternalServerError', message: 'PDS unavailable' },
                { status: 500 },
              );
            const data = await request.json<{
              repo: string;
              collection: string;
              rkey: string;
              record: Record<string, unknown>;
            }>();
            publishedAtprotoRecords.push(data.record);
            return WorkerResponse.json({
              uri: `at://${data.repo}/${data.collection}/${data.rkey}`,
              cid: 'bafyreie5cvnrvd6gd3wmqx5r3gkqjfwq3fvmsk6i3q4c2av4d6sp6j5sja',
            });
          }
          if (request.url === 'https://pds.example/xrpc/com.atproto.repo.createRecord') {
            const data = await request.json<{
              repo: string;
              collection: string;
              record: Record<string, unknown>;
            }>();
            publishedAtprotoRecords.push(data.record);
            return WorkerResponse.json({
              uri: `at://${data.repo}/${data.collection}/record${publishedAtprotoRecords.length}`,
              cid: 'bafyreie5cvnrvd6gd3wmqx5r3gkqjfwq3fvmsk6i3q4c2av4d6sp6j5sja',
            });
          }
          if (request.url === 'https://auth.example/.well-known/oauth-authorization-server')
            return WorkerResponse.json({
              issuer: 'https://auth.example',
              authorization_endpoint: 'https://auth.example/authorize',
              token_endpoint: 'https://auth.example/token',
              pushed_authorization_request_endpoint: 'https://auth.example/par',
              response_types_supported: ['code'],
              grant_types_supported: ['authorization_code', 'refresh_token'],
              code_challenge_methods_supported: ['S256'],
              token_endpoint_auth_methods_supported: ['none'],
              dpop_signing_alg_values_supported: ['ES256'],
              client_id_metadata_document_supported: true,
            });
          throw new Error(`Unexpected external request: ${request.url}`);
        },
      }),
    );
    db = await runtime.getD1Database('DB');
    const migrations = await Promise.all(
      [
        '0001_initial.sql',
        '0002_activity_photos.sql',
        '0003_atproto.sql',
        '0004_atproto_handle_index.sql',
        '0005_event_conferences.sql',
        '0006_social.sql',
        '0007_photo_deletions.sql',
        '0008_rate_limits.sql',
        '0009_account_mutation_locks.sql',
      ].map((file) => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')),
    );
    for (const migration of migrations.slice(0, 3)) {
      for (const statement of migration
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean))
        await db.prepare(statement).run();
    }
    await db
      .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
      .bind('did:plc:migration', 'migration.example', 'Migration', '2026-01-01')
      .run();
    await db
      .prepare('INSERT INTO atproto_sessions (token_hash, did, expires_at) VALUES (?, ?, ?)')
      .bind('migration-session', 'did:plc:migration', '2099-01-01')
      .run();
    await db
      .prepare(
        'INSERT INTO atproto_activities (uri, did, rkey, record_json, indexed_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        'at://did:plc:migration/dev.devswhorun.activity/a',
        'did:plc:migration',
        'a',
        '{}',
        '2026-01-01',
      )
      .run();
    await db
      .prepare(
        'INSERT INTO atproto_events (uri, did, rkey, record_json, title, sport, starts_at, location, level, capacity, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        'at://did:plc:migration/dev.devswhorun.event/e',
        'did:plc:migration',
        'e',
        '{}',
        'Event',
        'Running',
        '2099-01-01',
        'Park',
        'All',
        2,
        '2026-01-01',
      )
      .run();
    await db
      .prepare('INSERT INTO atproto_event_attendees (event_uri, attendee_id) VALUES (?, ?)')
      .bind('at://did:plc:migration/dev.devswhorun.event/e', 'github:alice')
      .run();
    await db
      .prepare(
        'INSERT INTO atproto_agent_tokens (id, did, token_hash, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        'migration-token',
        'did:plc:migration',
        'migration-hash',
        'Migration',
        '[]',
        '2026-01-01',
        '2099-01-01',
      )
      .run();
    for (const statement of migrations
      .slice(3)
      .join(';')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
    for (const table of [
      'atproto_sessions',
      'atproto_activities',
      'atproto_events',
      'atproto_event_attendees',
      'atproto_agent_tokens',
    ]) {
      expect(
        await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>(),
      ).toEqual({ count: 1 });
    }
    await db.prepare('DELETE FROM atproto_accounts WHERE did = ?').bind('did:plc:migration').run();
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

  beforeEach(async () => {
    await db.prepare('DELETE FROM rate_limits').run();
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

  it('returns more than 100 visible profile activities without exposing private ones', async () => {
    await db
      .prepare(
        "INSERT INTO users (id, github_id, username, name, visibility) VALUES ('history', 999, 'history', 'History', 'public')",
      )
      .run();
    await db.batch(
      Array.from({ length: 105 }, (_, index) =>
        db
          .prepare(
            'INSERT INTO activities (id, user_id, title, sport, occurred_at, duration, visibility, source, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            `history-${index}`,
            'history',
            'Walk',
            'Walking',
            '2020-01-01T12:00:00.000Z',
            30,
            index === 104 ? 'private' : 'public',
            'web',
            '',
          ),
      ),
    );
    const publicProfile = await (
      await request('/api/profiles/history')
    ).json<{ activities: { id: string }[] }>();
    expect(publicProfile.activities).toHaveLength(104);
    expect(publicProfile.activities.some((item) => item.id === 'history-104')).toBe(false);
    await db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(hash('history-session'), 'history', '2099-01-01')
      .run();
    const ownProfile = await (
      await request('/api/profiles/history', 'GET', undefined, 'history-session')
    ).json<{ activities: { id: string }[] }>();
    expect(ownProfile.activities).toHaveLength(105);
    await db.prepare("DELETE FROM users WHERE id = 'history'").run();
  });

  it('returns more than 100 indexed AT Protocol profile activities', async () => {
    const did = 'did:plc:history';
    await db
      .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
      .bind(did, 'history.example', 'History', '2026-01-01')
      .run();
    await db.batch(
      Array.from({ length: 105 }, (_, index) =>
        db
          .prepare(
            'INSERT INTO atproto_activities (uri, did, rkey, record_json, indexed_at) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(
            `at://${did}/dev.devswhorun.activity/${index}`,
            did,
            String(index),
            JSON.stringify({ ...activity, visibility: 'public' }),
            '2026-01-01',
          ),
      ),
    );
    const profile = await (
      await request(`/api/profiles/${encodeURIComponent(did)}`)
    ).json<{ activities: unknown[] }>();
    expect(profile.activities).toHaveLength(105);
    await db.prepare('DELETE FROM atproto_accounts WHERE did = ?').bind(did).run();
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

  it('shares public activities as PNG cards with OpenGraph pages and hides private ones', async () => {
    const created = await request(
      '/api/activities',
      'POST',
      {
        ...activity,
        title: 'Lunch <run> & "tempo"',
        notes: 'Never put notes on a card.',
        visibility: 'public',
      },
      charlie,
    );
    expect(created.status).toBe(201);
    const { id } = await created.json<{ id: string }>();

    const card = await request(
      `/api/activities/${id}/card.png`,
      'GET',
      undefined,
      undefined,
      undefined,
      {
        Origin: '',
      },
    );
    expect(card.status).toBe(200);
    expect(card.headers.get('Content-Type')).toBe('image/png');
    const png = new Uint8Array(await card.arrayBuffer());
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = new DataView(png.buffer, png.byteOffset + 16, 8);
    expect([ihdr.getUint32(0), ihdr.getUint32(4)]).toEqual([1200, 630]);

    const page = await request(`/activities/${id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(
      `<meta property="og:image" content="${origin}/api/activities/${id}/card.png?v=`,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(`<link rel="canonical" href="${origin}/activities/${id}" />`);
    expect(html).toContain('Lunch &lt;run&gt; &amp; &quot;tempo&quot;');
    expect(html).not.toContain('<run>');
    expect(html).not.toContain('Never put notes');
    expect(html).not.toContain('content="Default"');

    const single = await (
      await request(`/api/activities/${id}`)
    ).json<{ activity: { title: string } }>();
    expect(single.activity.title).toBe('Lunch <run> & "tempo"');

    expect(
      (await request(`/api/activities/${id}`, 'PATCH', { visibility: 'private' }, charlie)).status,
    ).toBe(200);
    expect((await request(`/api/activities/${id}/card.png`)).status).toBe(404);
    expect((await request(`/api/activities/${id}`)).status).toBe(404);
    expect((await request(`/api/activities/${id}`, 'GET', undefined, charlie)).status).toBe(200);
    const privatePage = await (await request(`/activities/${id}`)).text();
    expect(privatePage).not.toContain('og:image');
    expect(privatePage).toContain('<title>Devs Who Move</title>');

    // Public activities on a private profile are not shareable.
    const hidden = await request(
      '/api/activities',
      'POST',
      { ...activity, visibility: 'public' },
      bob,
    );
    const hiddenId = (await hidden.json<{ id: string }>()).id;
    expect((await request(`/api/activities/${hiddenId}/card.png`)).status).toBe(404);
    expect(await (await request(`/activities/${hiddenId}`)).text()).not.toContain('og:image');
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

  it('makes agent activities public, preserves idempotency and supports owned photos', async () => {
    const headers = { 'Idempotency-Key': 'first-run' };
    const first = await request('/api/activities', 'POST', activity, undefined, token, headers);
    expect(first.status).toBe(201);
    const firstResult = await first.json();
    const second = await request('/api/activities', 'POST', activity, undefined, token, headers);
    expect(second.status).toBe(200);
    expect(firstResult).toEqual(await second.json());
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
    ).toBe(201);
    const stored = await db
      .prepare("SELECT source, visibility FROM activities WHERE idempotency_key = 'first-run'")
      .first();
    expect(stored).toMatchObject({ source: 'agent', visibility: 'public' });
    const agentActivity = (await db
      .prepare("SELECT id FROM activities WHERE idempotency_key = 'first-run'")
      .first<{ id: string }>())!.id;
    expect((await upload(agentActivity, photo, undefined, token)).status).toBe(200);
    expect((await upload(activityId, photo, undefined, token)).status).toBe(200);
    expect(
      (await request(`/api/activities/${activityId}/photo`, 'DELETE', undefined, undefined, token))
        .status,
    ).toBe(200);
    const foreign = await request('/api/activities', 'POST', activity, bob);
    const foreignId = (await foreign.json<{ id: string }>()).id;
    expect((await upload(foreignId, photo, undefined, token)).status).toBe(404);
    expect(await storedPhotos()).toBe(1);
    expect(
      (await request(`/api/activities/${agentActivity}`, 'DELETE', undefined, alice)).status,
    ).toBe(200);
    expect(await storedPhotos()).toBe(0);
  });

  it('retries queued photo deletions on a later activity delete', async () => {
    const bucket = await runtime.getR2Bucket('PHOTOS');
    await bucket.put('activities/orphan/photo', new Uint8Array([1]));
    await db
      .prepare('INSERT INTO photo_deletions (key, queued_at) VALUES (?, ?)')
      .bind('activities/orphan/photo', '2026-01-01T00:00:00.000Z')
      .run();
    expect((await request('/api/activities/missing', 'DELETE', undefined, alice)).status).toBe(404);
    expect(await bucket.get('activities/orphan/photo')).toBeNull();
    expect(await db.prepare('SELECT COUNT(*) AS count FROM photo_deletions').first('count')).toBe(
      0,
    );
  });

  it('imports valid bulk items while returning validation and idempotency errors per item', async () => {
    const firstItem = { ...activity, idempotencyKey: 'bulk-run' };
    const response = await request(
      '/api/activities/bulk',
      'POST',
      {
        activities: [
          firstItem,
          { ...activity, duration: 0 },
          null,
          firstItem,
          { ...firstItem, duration: 40 },
          { ...activity, idempotencyKey: 'bulk-last-run' },
        ],
      },
      undefined,
      token,
    );
    expect(response.status).toBe(200);
    const { results } = await response.json<{
      results: { index: number; status: number; id?: string; error?: string }[];
    }>();
    expect(results).toEqual([
      { index: 0, status: 201, id: expect.any(String) },
      { index: 1, status: 400, error: 'Duration in minutes must be between 1 and 1440.' },
      { index: 2, status: 400, error: 'Expected an activity object.' },
      { index: 3, status: 200, id: results[0].id },
      {
        index: 4,
        status: 409,
        error: 'Idempotency key was already used with a different activity.',
      },
      { index: 5, status: 201, id: expect.any(String) },
    ]);
    expect(
      await db
        .prepare(
          "SELECT visibility, source FROM activities WHERE idempotency_key IN ('bulk-run', 'bulk-last-run')",
        )
        .all(),
    ).toMatchObject({
      results: [
        { visibility: 'public', source: 'agent' },
        { visibility: 'public', source: 'agent' },
      ],
    });
    const replay = await request('/api/activities', 'POST', activity, undefined, token, {
      'Idempotency-Key': 'bulk-run',
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ id: results[0].id });
    const feed = await (await request('/api/bootstrap')).json<{ activities: { id: string }[] }>();
    expect(feed.activities).not.toContainEqual(expect.objectContaining({ id: results[0].id }));
    await db.prepare("UPDATE users SET visibility = 'public' WHERE id = 'alice'").run();
    try {
      const publicFeed = await (
        await request('/api/bootstrap')
      ).json<{ activities: { id: string }[] }>();
      expect(publicFeed.activities).toContainEqual(
        expect.objectContaining({ id: results[0].id, visibility: 'public', source: 'agent' }),
      );
    } finally {
      await db.prepare("UPDATE users SET visibility = 'private' WHERE id = 'alice'").run();
    }
  });

  it('enforces bulk authentication, scopes, shape, count and byte limits before saving', async () => {
    const path = '/api/activities/bulk';
    const payload = { activities: [activity] };
    expect((await request(path, 'POST', payload)).status).toBe(401);
    const readToken = await (
      await request('/api/tokens', 'POST', { name: 'Reader', scopes: ['activities:read'] }, alice)
    ).json<{ id: string; token: string }>();
    expect((await request(path, 'POST', payload, undefined, readToken.token)).status).toBe(403);
    for (const data of [
      {},
      { activities: [] },
      { activities: 'invalid' },
      {
        activities: Array.from({ length: 101 }, () => activity),
      },
    ])
      expect((await request(path, 'POST', data, undefined, token)).status).toBe(400);
    expect(
      (await request(path, 'POST', payload, undefined, token, { 'Idempotency-Key': 'batch' }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          path,
          'POST',
          { padding: 'x'.repeat(1_048_576), ...payload },
          undefined,
          token,
        )
      ).status,
    ).toBe(413);
    const batch = Array.from({ length: 100 }, (_, i) => ({
      ...activity,
      title: `Large import ${i}`,
      notes: 'x'.repeat(2000),
    }));
    const imported = await request(path, 'POST', { activities: batch }, undefined, token);
    expect(imported.status).toBe(200);
    const { results } = await imported.json<{ results: { status: number; id: string }[] }>();
    expect(results).toHaveLength(100);
    expect(results.every(({ status }) => status === 201)).toBe(true);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS count FROM activities WHERE title LIKE 'Large import %'")
        .first(),
    ).toEqual({ count: 100 });
    await db.prepare("DELETE FROM activities WHERE title LIKE 'Large import %'").run();
    await request(`/api/tokens/${readToken.id}`, 'DELETE', undefined, alice);
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
      'get_weekly_recap',
      'list_activities',
      'create_activity',
      'create_activities',
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
      visibility: 'public',
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
        visibility: 'public',
      }),
    );

    const bulkArgs = {
      activities: [
        { ...activityArgs, idempotencyKey: 'mcp-bulk-1' },
        { ...activityArgs, duration: 0 },
      ],
    };
    const bulkCreated = await mcpRequest(
      'tools/call',
      { name: 'create_activities', arguments: bulkArgs },
      mcpToken.token,
    );
    expect(await bulkCreated.json()).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          results: [
            { index: 0, status: 201, id: expect.any(String) },
            { index: 1, status: 400, error: expect.any(String) },
          ],
        },
      },
    });
    expect(
      await db
        .prepare("SELECT source, visibility FROM activities WHERE idempotency_key = 'mcp-bulk-1'")
        .first(),
    ).toEqual({ source: 'agent', visibility: 'public' });

    const writeOnly = await mcpRequest('tools/list', {}, token);
    expect(
      (await writeOnly.json<{ result: { tools: { name: string }[] } }>()).result.tools.map(
        ({ name }) => name,
      ),
    ).toEqual(['create_activity', 'create_activities']);

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

  it('lets AT Protocol agents publish single and bulk activities without pretending to support idempotency', async () => {
    const did = 'did:plc:7sagqfh4v4t6zl7bdwbikdc2';
    const browserSession = 'atproto-activity-session';
    await db.batch([
      db
        .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
        .bind(did, 'activity.example', 'AT Protocol Activity', new Date().toISOString()),
      db
        .prepare('INSERT INTO atproto_sessions (token_hash, did, expires_at) VALUES (?, ?, ?)')
        .bind(hash(browserSession), did, '2099-01-01T00:00:00.000Z'),
      db
        .prepare(
          'INSERT INTO atproto_oauth_sessions (did, encrypted_session, updated_at) VALUES (?, ?, ?)',
        )
        .bind(did, encryptedAtprotoSession(did), new Date().toISOString()),
    ]);
    try {
      const response = await request(
        '/api/tokens',
        'POST',
        { name: 'AT Protocol writer', scopes: ['activities:write'] },
        browserSession,
      );
      expect(response.status).toBe(201);
      const writer = await response.json<{ token: string }>();
      const single = await request('/api/activities', 'POST', activity, undefined, writer.token);
      expect(single.status).toBe(201);
      expect(publishedAtprotoRecords).toHaveLength(1);
      expect(publishedAtprotoRecords[0]).toMatchObject({
        title: activity.title,
        source: 'agent',
        $type: 'dev.devswhorun.activity',
      });
      const bulk = await request(
        '/api/activities/bulk',
        'POST',
        {
          activities: [
            { ...activity, duration: 0 },
            { ...activity, idempotencyKey: 'unsupported' },
            { ...activity, title: 'AT Protocol bulk activity' },
          ],
        },
        undefined,
        writer.token,
      );
      expect(await bulk.json()).toMatchObject({
        results: [
          { index: 0, status: 400 },
          {
            index: 1,
            status: 400,
            error: 'Idempotency keys are not supported for AT Protocol activities.',
          },
          { index: 2, status: 201, id: expect.stringContaining(`at://${did}/`) },
        ],
      });
      expect(publishedAtprotoRecords).toHaveLength(2);
      const indexed = await db
        .prepare('SELECT record_json FROM atproto_activities WHERE did = ?')
        .bind(did)
        .all<{ record_json: string }>();
      expect(indexed.results).toHaveLength(2);
      expect(indexed.results.map(({ record_json }) => JSON.parse(record_json).source)).toEqual([
        'agent',
        'agent',
      ]);
    } finally {
      await db.prepare('DELETE FROM atproto_accounts WHERE did = ?').bind(did).run();
      await db.prepare('DELETE FROM atproto_oauth_sessions WHERE did = ?').bind(did).run();
    }
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

  it('rate limits event mutations and returns a retry delay', async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const response = await request('/api/events', 'POST', {}, alice);
      expect(response.status).toBe(400);
    }

    const limited = await request('/api/events', 'POST', {}, alice);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('keeps rate-limit buckets monotonic when an older window is submitted', async () => {
    const bucket = hash('event:account:alice');
    const futureWindow = Math.floor(Date.now() / 3_600_000) * 3_600 + 7_200;
    await db
      .prepare('INSERT INTO rate_limits (bucket, window_start, request_count) VALUES (?, ?, ?)')
      .bind(bucket, futureWindow, 5)
      .run();

    expect((await request('/api/events', 'POST', {}, alice)).status).toBe(400);
    expect(
      await db
        .prepare('SELECT window_start, request_count FROM rate_limits WHERE bucket = ?')
        .bind(bucket)
        .first(),
    ).toEqual({ window_start: futureWindow, request_count: 5 });
  });

  it('uses the event policy when an event ID contains the word visibility', async () => {
    const response = await request(
      '/api/events/visibility-example/join',
      'POST',
      { join: true },
      alice,
    );
    expect(response.status).toBe(404);
    expect(
      await db
        .prepare('SELECT request_count FROM rate_limits WHERE bucket = ?')
        .bind(hash('event:account:alice'))
        .first(),
    ).toEqual({ request_count: 1 });
    expect(
      await db
        .prepare('SELECT request_count FROM rate_limits WHERE bucket = ?')
        .bind(hash('activity:account:alice'))
        .first(),
    ).toBeNull();
  });

  it('lets only the host see event attendee names', async () => {
    expect((await request(`/api/events/${eventId}/join`, 'POST', { join: true }, bob)).status).toBe(
      200,
    );
    expect((await request(`/api/events/${eventId}/attendees`)).status).toBe(401);
    expect((await request(`/api/events/${eventId}/attendees`, 'GET', undefined, bob)).status).toBe(
      403,
    );
    const response = await request(`/api/events/${eventId}/attendees`, 'GET', undefined, alice);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      attendees: [
        { name: 'Alice', avatar: '' },
        { name: 'bob', avatar: '' },
      ],
    });
  });

  it('restricts encoded AT-URI attendee lists to the host and includes both account providers', async () => {
    const did = 'did:plc:7sagqfh4v4t6zl7bdwbikdc2';
    const uri = `at://${did}/dev.devswhorun.event/attendees`;
    const session = 'atproto-attendee-host-session';
    const path = `/api/events/${encodeURIComponent(uri)}/attendees`;
    await db.batch([
      db
        .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
        .bind(did, 'host.example', 'AT Protocol Host', new Date().toISOString()),
      db
        .prepare('INSERT INTO atproto_sessions (token_hash, did, expires_at) VALUES (?, ?, ?)')
        .bind(hash(session), did, '2099-01-01T00:00:00.000Z'),
      db
        .prepare(
          'INSERT INTO atproto_oauth_sessions (did, encrypted_session, updated_at) VALUES (?, ?, ?)',
        )
        .bind(did, encryptedAtprotoSession(did), new Date().toISOString()),
      db
        .prepare(
          `INSERT INTO atproto_events
            (uri, did, rkey, record_json, title, sport, starts_at, location, level, capacity, indexed_at)
          VALUES (?, ?, 'attendees', '{}', 'AT Protocol event', 'Running', ?, 'Park', 'All', 5, ?)`,
        )
        .bind(uri, did, '2098-01-01T09:00:00.000Z', new Date().toISOString()),
      db
        .prepare(
          'INSERT INTO atproto_event_attendees (event_uri, attendee_id) VALUES (?, ?), (?, ?)',
        )
        .bind(uri, 'github:alice', uri, `atproto:${did}`),
    ]);
    try {
      expect((await request(path)).status).toBe(401);
      expect((await request(path, 'GET', undefined, bob)).status).toBe(403);
      const response = await request(path, 'GET', undefined, session);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        attendees: [
          { name: 'AT Protocol Host', avatar: '' },
          { name: 'Alice', avatar: '' },
        ],
      });
    } finally {
      await db.prepare('DELETE FROM atproto_accounts WHERE did = ?').bind(did).run();
      await db.prepare('DELETE FROM atproto_oauth_sessions WHERE did = ?').bind(did).run();
    }
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

  const conferenceEvent = {
    title: 'NG-Conf morning 5K',
    sport: 'Running',
    startsAt: '2098-01-01T09:00:00.000Z',
    location: 'Convention center entrance',
    description: 'An easy morning run.',
    level: 'All levels welcome',
    capacity: 4,
    conferenceName: 'NG-Conf',
    conferenceUrl: 'https://ng-conf.example/2026',
  };
  const conferenceDid = 'did:plc:7sagqfh4v4t6zl7bdwbikdc2';
  const conferenceSession = 'atproto-conference-session';
  async function setupConferenceHost() {
    await db.batch([
      db
        .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
        .bind(conferenceDid, 'conference.example', 'Conference Host', new Date().toISOString()),
      db
        .prepare('INSERT INTO atproto_sessions (token_hash, did, expires_at) VALUES (?, ?, ?)')
        .bind(hash(conferenceSession), conferenceDid, '2099-01-01T00:00:00.000Z'),
      db
        .prepare(
          'INSERT INTO atproto_oauth_sessions (did, encrypted_session, updated_at) VALUES (?, ?, ?)',
        )
        .bind(conferenceDid, encryptedAtprotoSession(conferenceDid), new Date().toISOString()),
    ]);
  }
  async function cleanConferenceHost() {
    await db.prepare('DELETE FROM atproto_accounts WHERE did = ?').bind(conferenceDid).run();
    await db.prepare('DELETE FROM atproto_oauth_sessions WHERE did = ?').bind(conferenceDid).run();
    remoteAtprotoEvents = [];
    failAtprotoEventUpdate = false;
  }

  it.each(['github', 'atproto'])(
    'round-trips conference events for %s without changing normal events or capacity',
    async (provider) => {
      if (provider === 'atproto') await setupConferenceHost();
      const session = provider === 'atproto' ? conferenceSession : alice;
      let id = '';
      try {
        const created = await request(
          '/api/events',
          'POST',
          { ...conferenceEvent, conferenceName: ' NG-Conf ' },
          session,
        );
        expect(created.status).toBe(201);
        id = (await created.json<{ id: string }>()).id;
        const path = `/api/events/${encodeURIComponent(id)}`;
        const listed = async () => {
          const response = await request('/api/events');
          return (await response.json<{ events: Record<string, unknown>[] }>()).events.find(
            (event) => event['id'] === id,
          );
        };
        expect(await listed()).toMatchObject({ ...conferenceEvent, attendees: 1, joined: false });
        if (provider === 'atproto')
          expect(publishedAtprotoRecords.at(-1)).toMatchObject({
            ...conferenceEvent,
            $type: 'dev.devswhorun.event',
          });

        const unsafe = [
          { conferenceUrl: 'http://ng-conf.example' },
          { conferenceUrl: 'javascript:alert(1)' },
          { conferenceUrl: '//ng-conf.example' },
          { conferenceUrl: 'https://user:password@ng-conf.example' },
          { conferenceUrl: 'https://@ng-conf.example' },
          { conferenceUrl: 'https://ng-conf.example\\@evil.example' },
          { conferenceUrl: 'https://ng-conf.exa\nmple' },
          { conferenceUrl: 'https:///ng-conf.example' },
          { conferenceUrl: 'https://ng-conf.example/' + 'x'.repeat(2048) },
          { conferenceUrl: 123 },
          { conferenceName: '' },
          { conferenceName: 'x'.repeat(101) },
          { conferenceName: ['NG-Conf'] },
        ];
        for (const invalid of unsafe) {
          expect(
            (await request('/api/events', 'POST', { ...conferenceEvent, ...invalid }, session))
              .status,
          ).toBe(400);
          expect(
            (await request(path, 'PATCH', { ...conferenceEvent, ...invalid }, session)).status,
          ).toBe(400);
        }
        expect(await listed()).toMatchObject(conferenceEvent);
        const edited = {
          ...conferenceEvent,
          sport: 'Cycling',
          conferenceName: 'BikeConf',
          conferenceUrl: 'https://bikeconf.example/schedule',
        };
        expect((await request(path, 'PATCH', edited, session)).status).toBe(200);
        expect(await listed()).toMatchObject(edited);
        expect((await request(`${path}/join`, 'POST', { join: true }, bob)).status).toBe(200);
        expect((await request(`${path}/join`, 'POST', { join: true }, charlie)).status).toBe(200);
        expect((await request(path, 'PATCH', { ...edited, capacity: 2 }, session)).status).toBe(
          409,
        );
        expect(await listed()).toMatchObject({ ...edited, attendees: 3 });
        expect(
          (await request(path, 'PATCH', { ...edited, conferenceUrl: '' }, session)).status,
        ).toBe(200);
        expect(await listed()).toMatchObject({ conferenceName: 'BikeConf', conferenceUrl: null });
        const { conferenceName, conferenceUrl, ...normal } = edited;
        expect((await request(path, 'PATCH', normal, session)).status).toBe(200);
        expect(await listed()).toMatchObject({ conferenceName: null, conferenceUrl: null });
        if (provider === 'atproto') {
          expect(publishedAtprotoRecords.at(-1)).not.toHaveProperty('conferenceName');
          expect(publishedAtprotoRecords.at(-1)).not.toHaveProperty('conferenceUrl');
        }
      } finally {
        if (provider === 'atproto') await cleanConferenceHost();
        else if (id) await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
      }
    },
  );

  it('restores conference projections when an AT Protocol event update fails', async () => {
    await setupConferenceHost();
    try {
      const created = await request('/api/events', 'POST', conferenceEvent, conferenceSession);
      const { id } = await created.json<{ id: string }>();
      failAtprotoEventUpdate = true;
      const response = await request(
        `/api/events/${encodeURIComponent(id)}`,
        'PATCH',
        { ...conferenceEvent, conferenceName: 'Changed', conferenceUrl: null },
        conferenceSession,
      );
      expect(response.status).toBe(500);
      const indexed = await db
        .prepare(
          'SELECT conference_name, conference_url, record_json FROM atproto_events WHERE uri = ?',
        )
        .bind(id)
        .first<{ conference_name: string; conference_url: string; record_json: string }>();
      expect(indexed).toMatchObject({
        conference_name: conferenceEvent.conferenceName,
        conference_url: conferenceEvent.conferenceUrl,
      });
      expect(JSON.parse(indexed!.record_json)).toMatchObject(conferenceEvent);
    } finally {
      await cleanConferenceHost();
    }
  });

  it('validates conference fields in PDS event projections and accepts legacy omission', async () => {
    await setupConferenceHost();
    const cid = 'bafyreie5cvnrvd6gd3wmqx5r3gkqjfwq3fvmsk6i3q4c2av4d6sp6j5sja';
    const { conferenceName, conferenceUrl, ...legacy } = conferenceEvent;
    const records = [
      conferenceEvent,
      legacy,
      { ...conferenceEvent, conferenceUrl: 'http://ng-conf.example' },
      { ...conferenceEvent, conferenceUrl: 'https://user@ng-conf.example' },
      { ...conferenceEvent, conferenceName: '' },
      { ...conferenceEvent, conferenceName: 123 },
      { ...conferenceEvent, conferenceUrl: 123 },
    ];
    remoteAtprotoEvents = records.map((record, index) => ({
      uri: `at://${conferenceDid}/dev.devswhorun.event/import${index}`,
      cid,
      value: { $type: 'dev.devswhorun.event', ...record },
    }));
    try {
      await db
        .prepare('UPDATE atproto_accounts SET updated_at = ? WHERE did = ?')
        .bind('2026-01-01', conferenceDid)
        .run();
      expect((await request('/api/activities', 'GET', undefined, conferenceSession)).status).toBe(
        200,
      );
      const response = await request('/api/bootstrap', 'GET', undefined, conferenceSession);
      expect(response.status).toBe(200);
      const { events } = await response.json<{ events: Record<string, unknown>[] }>();
      const imported = events.filter((event) => event['hostId'] === conferenceDid);
      expect(imported).toHaveLength(2);
      expect(imported.find((event) => String(event['id']).endsWith('/import0'))).toMatchObject(
        conferenceEvent,
      );
      expect(imported.find((event) => String(event['id']).endsWith('/import1'))).toMatchObject({
        conferenceName: null,
        conferenceUrl: null,
      });
      remoteAtprotoEvents[0].value = { $type: 'dev.devswhorun.event', ...legacy };
      await db
        .prepare('UPDATE atproto_accounts SET updated_at = ? WHERE did = ?')
        .bind('2026-01-01', conferenceDid)
        .run();
      await request('/api/bootstrap', 'GET', undefined, conferenceSession);
      const updated = await db
        .prepare('SELECT conference_name, conference_url FROM atproto_events WHERE uri = ?')
        .bind(remoteAtprotoEvents[0].uri)
        .first();
      expect(updated).toEqual({ conference_name: null, conference_url: null });
    } finally {
      await cleanConferenceHost();
    }
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

  it('exports account data including photos without exposing token hashes', async () => {
    const accountId = 'export-me';
    const session = 'export-session';
    await db
      .prepare(
        'INSERT INTO users (id, github_id, username, name, visibility) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(accountId, 9901, 'export-me', 'Export Me', 'public')
      .run();
    await db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(hash(session), accountId, '2099-01-01T00:00:00.000Z')
      .run();
    await db
      .prepare(
        `INSERT INTO activities (id, user_id, title, sport, occurred_at, duration, notes, visibility, source, payload_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'export-activity',
        accountId,
        'Export run',
        'Running',
        '2026-01-01T08:00:00.000Z',
        30,
        'My notes',
        'public',
        'web',
        'payload',
      )
      .run();
    const photoKey = 'activities/export-activity/photo.jpg';
    await (await runtime.getR2Bucket('PHOTOS')).put(photoKey, photo);
    await db
      .prepare('UPDATE activities SET photo_key = ?, photo_type = ? WHERE id = ?')
      .bind(photoKey, 'image/jpeg', 'export-activity')
      .run();
    await db
      .prepare(
        'INSERT INTO agent_tokens (id, user_id, token_hash, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        'export-token',
        accountId,
        'secret-token-hash',
        'Watch',
        '[]',
        '2026-01-01',
        '2099-01-01',
      )
      .run();

    const response = await request('/api/account/export', 'GET', undefined, session);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    const exported = await response.json<{
      activities: { id: string; notes: string }[];
      agentTokens: Record<string, unknown>[];
      photos: { activityId: string; contentType: string; dataBase64: string }[];
    }>();
    expect(exported.activities).toContainEqual(
      expect.objectContaining({ id: 'export-activity', notes: 'My notes' }),
    );
    expect(exported.agentTokens).toEqual([
      expect.objectContaining({ id: 'export-token', name: 'Watch' }),
    ]);
    expect(JSON.stringify(exported)).not.toContain('secret-token-hash');
    expect(exported.photos).toEqual([
      {
        activityId: 'export-activity',
        contentType: 'image/jpeg',
        dataBase64: Buffer.from(photo).toString('base64'),
      },
    ]);
  });

  it('requires typed confirmation and removes account data and photos on deletion', async () => {
    const accountId = 'delete-me';
    const session = 'delete-session';
    await db
      .prepare(
        'INSERT INTO users (id, github_id, username, name, visibility) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(accountId, 9902, 'delete-me', 'Delete Me', 'public')
      .run();
    await db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(hash(session), accountId, '2099-01-01T00:00:00.000Z')
      .run();
    await db
      .prepare(
        `INSERT INTO activities (id, user_id, title, sport, occurred_at, duration, source, payload_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'delete-activity',
        accountId,
        'Delete run',
        'Running',
        '2026-01-01T08:00:00.000Z',
        30,
        'web',
        'payload',
      )
      .run();
    await db
      .prepare(
        `INSERT INTO events (id, host_id, title, sport, starts_at, location, level, capacity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'delete-event',
        accountId,
        'Delete event',
        'Running',
        '2099-01-01T08:00:00.000Z',
        'Park',
        'All',
        10,
      )
      .run();
    await db
      .prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)')
      .bind(accountId, 'alice', '2026-01-01')
      .run();
    const photoKey = 'activities/delete-activity/photo.jpg';
    await (await runtime.getR2Bucket('PHOTOS')).put(photoKey, photo);
    await db
      .prepare('UPDATE activities SET photo_key = ?, photo_type = ? WHERE id = ?')
      .bind(photoKey, 'image/jpeg', 'delete-activity')
      .run();

    const rejected = await request('/api/account', 'DELETE', { confirmation: 'delete' }, session);
    expect(rejected.status).toBe(400);
    expect(await db.prepare('SELECT id FROM users WHERE id = ?').bind(accountId).first()).toEqual({
      id: accountId,
    });

    await db
      .prepare(
        'INSERT INTO account_mutation_locks (actor_id, deleting, active_writes) VALUES (?, 0, 1)',
      )
      .bind(`github:${accountId}`)
      .run();
    const deletion = request('/api/account', 'DELETE', { confirmation: 'DELETE' }, session);
    for (let attempt = 0; attempt < 100; attempt++) {
      const lock = await db
        .prepare('SELECT deleting FROM account_mutation_locks WHERE actor_id = ?')
        .bind(`github:${accountId}`)
        .first<{ deleting: number }>();
      if (lock?.deleting) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(
      (
        await db
          .prepare('SELECT deleting FROM account_mutation_locks WHERE actor_id = ?')
          .bind(`github:${accountId}`)
          .first<{ deleting: number }>()
      )?.deleting,
    ).toBe(1);
    expect((await request('/api/activities', 'POST', activity, session)).status).toBe(409);
    await db
      .prepare('UPDATE account_mutation_locks SET active_writes = 0 WHERE actor_id = ?')
      .bind(`github:${accountId}`)
      .run();

    const response = await deletion;
    expect(response.status).toBe(204);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    for (const table of ['users', 'activities', 'events', 'sessions', 'follows']) {
      const row = await db
        .prepare(
          table === 'follows'
            ? 'SELECT COUNT(*) AS count FROM follows WHERE follower_id = ? OR followee_id = ?'
            : table === 'activities'
              ? 'SELECT COUNT(*) AS count FROM activities WHERE user_id = ?'
              : table === 'events'
                ? 'SELECT COUNT(*) AS count FROM events WHERE host_id = ?'
                : table === 'sessions'
                  ? 'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?'
                  : 'SELECT COUNT(*) AS count FROM users WHERE id = ?',
        )
        .bind(...(table === 'follows' ? [accountId, accountId] : [accountId]))
        .first<{ count: number }>();
      expect(row?.count).toBe(0);
    }
    expect(
      await db
        .prepare('SELECT 1 FROM account_mutation_locks WHERE actor_id = ?')
        .bind(`github:${accountId}`)
        .first(),
    ).toBeNull();
    expect(
      await db
        .prepare('SELECT 1 FROM rate_limits WHERE bucket IN (?, ?)')
        .bind(hash(`write:account:${accountId}`), hash(`activity:account:${accountId}`))
        .first(),
    ).toBeNull();
    expect(await (await runtime.getR2Bucket('PHOTOS')).get(photoKey)).toBeNull();
    expect((await request('/api/bootstrap')).status).toBe(200);
  });

  it('serves all public AT Protocol activities and resolves duplicate handles deterministically', async () => {
    const accounts = [
      ['did:plc:older', 'duplicate.example', 'Older', '2026-01-01T00:00:00.000Z'],
      ['did:plc:newer', 'duplicate.example', 'Newer', '2026-02-01T00:00:00.000Z'],
    ];
    for (const [did, handle, name, updatedAt] of accounts) {
      await db
        .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
        .bind(did, handle, name, updatedAt)
        .run();
      const occurredAt = did.endsWith('newer')
        ? '2026-02-01T08:00:00.000Z'
        : '2026-01-01T08:00:00.000Z';
      const uri = `at://${did}/dev.devswhorun.activity/activity`;
      await db
        .prepare(
          `INSERT INTO atproto_activities (uri, did, rkey, record_json, indexed_at)
          VALUES (?, ?, 'activity', ?, ?)`,
        )
        .bind(
          uri,
          did,
          JSON.stringify({
            $type: 'dev.devswhorun.activity',
            title: name,
            sport: 'Running',
            occurredAt,
            duration: 30,
            notes: '',
            source: 'web',
          }),
          updatedAt,
        )
        .run();
    }

    const feed = await (
      await request('/api/bootstrap')
    ).json<{
      activities: { id: string; title: string }[];
    }>();
    expect(feed.activities.map(({ title }) => title)).toContain('Older');
    expect(feed.activities.map(({ title }) => title)).toContain('Newer');

    const profile = await (
      await request('/api/profiles/duplicate.example')
    ).json<{ profile: { id: string; name: string }; activities: { title: string }[] }>();
    expect(profile.profile).toMatchObject({ id: 'did:plc:newer', name: 'Newer' });
    expect(profile.activities.map(({ title }) => title)).toEqual(['Newer']);
  });

  it('keeps anonymous browsing available for expired AT Protocol authorization and preserves transient failures', async () => {
    const did = 'did:plc:session-test';
    const browserSession = 'atproto-browser-session';
    await db
      .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
      .bind(did, 'session.example', 'Session Test', '1970-01-01T00:00:00.000Z')
      .run();
    await db
      .prepare('INSERT INTO atproto_sessions (token_hash, did, expires_at) VALUES (?, ?, ?)')
      .bind(hash(browserSession), did, '2099-01-01T00:00:00.000Z')
      .run();
    await db
      .prepare(
        'INSERT INTO atproto_oauth_sessions (did, encrypted_session, updated_at) VALUES (?, ?, ?)',
      )
      .bind(did, 'invalid-encrypted-data', new Date().toISOString())
      .run();

    expect((await request('/api/bootstrap', 'GET', undefined, browserSession)).status).toBe(503);
    expect(
      await db
        .prepare('SELECT 1 FROM atproto_sessions WHERE token_hash = ?')
        .bind(hash(browserSession))
        .first(),
    ).toBeTruthy();

    await db.prepare('DELETE FROM atproto_oauth_sessions WHERE did = ?').bind(did).run();
    const anonymous = await request('/api/bootstrap', 'GET', undefined, browserSession);
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toMatchObject({ viewer: null });
    expect(
      await db
        .prepare('SELECT 1 FROM atproto_sessions WHERE token_hash = ?')
        .bind(hash(browserSession))
        .first(),
    ).toBeNull();
  });
});
