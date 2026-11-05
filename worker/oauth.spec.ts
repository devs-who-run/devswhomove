import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertV4MiniflareOptions, Miniflare, Response } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';

describe('MCP OAuth authorization server', () => {
  let runtime: Miniflare;
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
  const origin = 'https://move.example';
  const alice = 'a'.repeat(64);
  const bob = 'b'.repeat(64);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const loopback = 'http://127.0.0.1:3000/callback';
  const metadataClientId = 'https://client.example/oauth/metadata.json';
  const mismatchedClientId = 'https://client.example/oauth/mismatched.json';
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  let clientId: string;

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
        bindings: {
          APP_URL: `${origin}/`,
          GITHUB_CLIENT_ID: 'test-client',
          GITHUB_CLIENT_SECRET: 'test-secret',
          ATPROTO_OAUTH_PRIVATE_KEY: Buffer.from(
            privateKey.export({ type: 'pkcs8', format: 'pem' }),
          ).toString('base64'),
          ATPROTO_SESSION_KEY: Buffer.alloc(32, 7).toString('base64'),
        },
        outboundService: async (request) => {
          if (request.url === metadataClientId)
            return Response.json({
              client_id: metadataClientId,
              client_name: 'Example Agent',
              redirect_uris: ['http://127.0.0.1/callback'],
              token_endpoint_auth_method: 'none',
            });
          if (request.url === mismatchedClientId)
            return Response.json({
              client_id: 'https://other.example/metadata.json',
              redirect_uris: ['http://127.0.0.1/callback'],
            });
          throw new Error(`Unexpected external request: ${request.url}`);
        },
      }),
    );
    db = await runtime.getD1Database('DB');
    const migration = (
      await Promise.all(
        [
          '0001_initial.sql',
          '0002_activity_photos.sql',
          '0003_atproto.sql',
          '0004_atproto_handle_index.sql',
          '0005_mcp_oauth.sql',
        ].map((file) => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')),
      )
    ).join(';');
    for (const statement of migration
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
    for (const [id, session] of [
      ['alice', alice],
      ['bob', bob],
    ]) {
      await db
        .prepare('INSERT INTO users (id, github_id, username, name) VALUES (?, ?, ?, ?)')
        .bind(id, id.charCodeAt(0), id, id)
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

  function authorizeQuery(overrides: Record<string, string | null> = {}) {
    const params: Record<string, string | null> = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:4567/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      resource: `${origin}/mcp`,
      ...overrides,
    };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== null) query.set(key, value);
    return query.toString();
  }

  function authorizePage(query: string, session?: string) {
    return runtime.dispatchFetch(`${origin}/oauth/authorize?${query}`, {
      headers: session ? { Cookie: `dwm_session=${session}` } : {},
      redirect: 'manual',
    });
  }

  function decide(
    query: string,
    decision: 'approve' | 'deny',
    scopes: string[] = [],
    session = alice,
    requestOrigin: string | null = origin,
  ) {
    const body = new URLSearchParams([['decision', decision], ...scopes.map((s) => ['scope', s])]);
    return runtime.dispatchFetch(`${origin}/oauth/authorize?${query}`, {
      method: 'POST',
      headers: {
        ...(requestOrigin ? { Origin: requestOrigin } : {}),
        Cookie: `dwm_session=${session}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      redirect: 'manual',
    });
  }

  function tokenRequest(params: Record<string, string>, path = '/oauth/token') {
    return runtime.dispatchFetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  }

  async function authorizationCode(
    scopes = ['activities:read', 'activities:write', 'events:read'],
    overrides: Record<string, string | null> = {},
  ) {
    const response = await decide(authorizeQuery(overrides), 'approve', scopes);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('Location')!);
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.get('iss')).toBe(origin);
    return location.searchParams.get('code')!;
  }

  async function grant(scopes?: string[], client = clientId) {
    const code = await authorizationCode(scopes, { client_id: client });
    const response = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: client,
      redirect_uri: 'http://127.0.0.1:4567/callback',
      resource: `${origin}/mcp`,
    });
    expect(response.status).toBe(200);
    return response.json<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>();
  }

  function mcp(method: string, bearer?: string, protocolVersion = '2026-07-28') {
    return runtime.dispatchFetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': protocolVersion,
        'Mcp-Method': method,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': protocolVersion,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
  }

  async function toolNames(bearer: string) {
    const response = await mcp('tools/list', bearer);
    expect(response.status).toBe(200);
    return (await response.json<{ result: { tools: { name: string }[] } }>()).result.tools.map(
      ({ name }) => name,
    );
  }

  it('publishes discovery metadata and challenges unauthenticated MCP requests', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const response = await runtime.dispatchFetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['activities:read', 'activities:write', 'events:read'],
        bearer_methods_supported: ['header'],
        resource_name: 'devswhomove MCP',
      });
    }
    const server = await runtime.dispatchFetch(`${origin}/.well-known/oauth-authorization-server`);
    expect(server.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await server.json()).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    });
    const preflight = await runtime.dispatchFetch(`${origin}/oauth/token`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');

    // An unauthenticated client gets the challenge before protocol negotiation.
    const anonymous = await mcp('server/discover', undefined, '2025-06-18');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('WWW-Authenticate')).toBe(
      `Bearer realm="devs-who-move MCP", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="activities:read activities:write events:read"`,
    );
    const invalid = await mcp('server/discover', `dwm_${'0'.repeat(64)}`);
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
    expect(invalid.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  });

  it('registers public clients with safe redirect URIs only', async () => {
    const register = (body: unknown, contentType = 'application/json') =>
      runtime.dispatchFetch(`${origin}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    for (const redirect_uris of [
      ['http://evil.example/callback'],
      ['javascript:alert(1)'],
      ['https://ok.example/callback#fragment'],
      [],
    ]) {
      const response = await register({ redirect_uris });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    }
    expect((await register('not json')).status).toBe(400);
    expect((await register({ redirect_uris: [loopback] }, 'text/plain')).status).toBe(400);

    const response = await register({
      client_name: '<script>alert(1)</script>',
      redirect_uris: [loopback, 'com.example.agent:/oauth'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const client = await response.json<Record<string, unknown>>();
    expect(client).toMatchObject({
      client_name: '<script>alert(1)</script>',
      redirect_uris: [loopback, 'com.example.agent:/oauth'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
    expect(client).not.toHaveProperty('client_secret');
    clientId = client['client_id'] as string;
    expect(clientId).toMatch(/^mcp_/);
  });

  it('never redirects to unverified addresses and reports other errors to the client', async () => {
    const unknown = await authorizePage(authorizeQuery({ client_id: 'mcp_missing' }), alice);
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get('Location')).toBeNull();
    expect(unknown.headers.get('Content-Type')).toContain('text/html');

    for (const redirect_uri of [
      'http://127.0.0.1:3000/other',
      'http://localhost:3000/callback',
      'https://evil.example/callback',
    ]) {
      const mismatch = await authorizePage(authorizeQuery({ redirect_uri }), alice);
      expect(mismatch.status).toBe(400);
      expect(mismatch.headers.get('Location')).toBeNull();
    }

    for (const [overrides, error] of [
      [{ code_challenge: null }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
      [{ scope: 'admin' }, 'invalid_scope'],
    ] as const) {
      const response = await authorizePage(authorizeQuery(overrides), alice);
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('Location')!);
      expect(`${location.origin}${location.pathname}`).toBe('http://127.0.0.1:4567/callback');
      expect(location.searchParams.get('error')).toBe(error);
      expect(location.searchParams.get('state')).toBe('xyz');
      expect(location.searchParams.get('iss')).toBe(origin);
    }
  });

  it('asks signed-out people to sign in and returns them to the request', async () => {
    const query = authorizeQuery();
    const response = await authorizePage(query);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain(
      `/auth/github?return_to=${encodeURIComponent(`/oauth/authorize?${query}`)}`,
    );
    expect(html).toContain('Continue with AT Protocol');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('shows consent, requires a same-site form post and lets people deny access', async () => {
    const query = authorizeQuery();
    const consent = await authorizePage(query, alice);
    expect(consent.status).toBe(200);
    const html = await consent.text();
    expect(html).toContain('Allow access');
    expect(html).toContain('127.0.0.1:4567');
    expect(html).toContain('not verified');
    expect(html.match(/name="scope"/g)).toHaveLength(3);
    expect(html).not.toContain('<script>');

    expect((await decide(query, 'approve', ['events:read'], alice, null)).status).toBe(403);
    expect(
      (await decide(query, 'approve', ['events:read'], alice, 'https://evil.example')).status,
    ).toBe(403);
    const noScope = await decide(query, 'approve', []);
    expect(noScope.status).toBe(400);
    expect(await noScope.text()).toContain('Choose at least one permission.');

    const denied = await decide(query, 'deny');
    expect(denied.status).toBe(303);
    const location = new URL(denied.headers.get('Location')!);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.has('code')).toBe(false);
  });

  it('issues single-use codes bound to PKCE, the client and the redirect URI', async () => {
    const exchange = (code: string, overrides: Record<string, string> = {}) =>
      tokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4567/callback',
        ...overrides,
      });

    const guessed = await authorizationCode();
    const wrongVerifier = await exchange(guessed, {
      code_verifier: randomBytes(32).toString('base64url'),
    });
    expect(wrongVerifier.status).toBe(400);
    expect(await wrongVerifier.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await exchange(guessed)).status).toBe(400);

    expect((await exchange(await authorizationCode(), { client_id: 'mcp_other' })).status).toBe(
      400,
    );
    expect(
      (await exchange(await authorizationCode(), { redirect_uri: 'http://127.0.0.1:1/callback' }))
        .status,
    ).toBe(400);
    expect(
      (await exchange(await authorizationCode(), { resource: 'https://other.example/' })).status,
    ).toBe(400);
    expect((await exchange(await authorizationCode(), { grant_type: 'password' })).status).toBe(
      400,
    );

    const code = await authorizationCode(['activities:read', 'events:read']);
    const response = await exchange(code);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const tokens = await response.json<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>();
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'activities:read events:read',
    });
    expect(tokens.access_token).toMatch(/^dwm_[a-f0-9]{64}$/);
    expect(tokens.refresh_token).toMatch(/^dwmr_[a-f0-9]{64}$/);
    expect((await exchange(code)).status).toBe(400);
    expect(await toolNames(tokens.access_token)).toEqual([
      'list_activities',
      'list_upcoming_events',
    ]);

    const listing = await runtime.dispatchFetch(`${origin}/api/tokens`, {
      headers: { Cookie: `dwm_session=${alice}` },
    });
    const text = await listing.text();
    expect(text).not.toContain(tokens.access_token);
    expect(text).not.toContain(tokens.refresh_token);
    const { tokens: agents } = JSON.parse(text) as {
      tokens: { name: string; scopes: string[]; expiresAt: string }[];
    };
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: '<script>alert(1)</script>',
      scopes: ['activities:read', 'events:read'],
    });
    expect(Date.parse(agents[0].expiresAt)).toBeGreaterThan(Date.now() + 89 * 86400_000);

    // Re-authorizing the same registered client replaces its previous connection.
    const replacement = await grant(['activities:write']);
    expect(await toolNames(replacement.access_token)).toEqual(['create_activity']);
    expect((await mcp('tools/list', tokens.access_token)).status).toBe(401);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS count FROM agent_tokens WHERE client_id = ?')
        .bind(clientId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it('rotates refresh tokens and honours every kind of revocation', async () => {
    const first = await grant();
    const refresh = (refresh_token: string, client = clientId) =>
      tokenRequest({ grant_type: 'refresh_token', refresh_token, client_id: client });

    expect((await refresh(first.refresh_token, 'mcp_other')).status).toBe(400);
    const rotated = await refresh(first.refresh_token);
    expect(rotated.status).toBe(200);
    const second = await rotated.json<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    }>();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.scope).toBe('activities:read activities:write events:read');
    expect(second.expires_in).toBeGreaterThan(3500);
    expect((await mcp('tools/list', first.access_token)).status).toBe(401);
    expect(await toolNames(second.access_token)).toHaveLength(3);
    expect((await refresh(first.refresh_token)).status).toBe(400);

    const id = (await db
      .prepare('SELECT id FROM agent_tokens WHERE client_id = ?')
      .bind(clientId)
      .first<{ id: string }>())!.id;
    const removed = await runtime.dispatchFetch(`${origin}/api/tokens/${id}`, {
      method: 'DELETE',
      headers: { Origin: origin, Cookie: `dwm_session=${alice}` },
    });
    expect(removed.status).toBe(200);
    expect((await mcp('tools/list', second.access_token)).status).toBe(401);
    expect((await refresh(second.refresh_token)).status).toBe(400);

    const third = await grant();
    const revoked = await tokenRequest(
      { token: third.refresh_token, client_id: clientId },
      '/oauth/revoke',
    );
    expect(revoked.status).toBe(200);
    expect((await mcp('tools/list', third.access_token)).status).toBe(401);
    expect((await refresh(third.refresh_token)).status).toBe(400);
  });

  it('supports clients identified by HTTPS metadata documents', async () => {
    const consent = await authorizePage(
      authorizeQuery({
        client_id: metadataClientId,
        redirect_uri: 'http://127.0.0.1:9999/callback',
      }),
      alice,
    );
    expect(consent.status).toBe(200);
    const html = await consent.text();
    expect(html).toContain('Example Agent');
    expect(html).toContain('published at client.example');

    const mismatched = await authorizePage(
      authorizeQuery({ client_id: mismatchedClientId, redirect_uri: 'http://127.0.0.1/callback' }),
      alice,
    );
    expect(mismatched.status).toBe(400);
    expect(mismatched.headers.get('Location')).toBeNull();

    const tokens = await grant(['events:read'], metadataClientId);
    expect(await toolNames(tokens.access_token)).toEqual(['list_upcoming_events']);
  });

  it('blocks new connections once ten agents are active', async () => {
    for (let index = 0; index < 10; index++)
      await db
        .prepare(
          'INSERT INTO agent_tokens (id, user_id, token_hash, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(`bob-${index}`, 'bob', `bob-hash-${index}`, 'Agent', '[]', '2026-01-01', '2099-01-01')
        .run();
    const consent = await authorizePage(authorizeQuery(), bob);
    expect(consent.status).toBe(200);
    const html = await consent.text();
    expect(html).toContain('You already have 10 active agent connections.');
    expect(html).not.toContain('Allow access');
    const approved = await decide(authorizeQuery(), 'approve', ['events:read'], bob);
    expect(new URL(approved.headers.get('Location')!).searchParams.get('error')).toBe(
      'access_denied',
    );
  });
});
