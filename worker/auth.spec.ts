import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertV4MiniflareOptions, Miniflare, Response } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  atprotoProfileChanges,
  ATPROTO_OAUTH_SCOPE,
  oauthClient,
  webCryptoDigest,
} from './atproto';

describe('GitHub OAuth protocol with mocked GitHub responses', () => {
  let runtime: Miniflare;
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
  const origin = 'https://move.example';
  let outboundCalls = 0;
  let githubTokenWasServerSide = false;
  let githubUsername = 'octo-runner';
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const atprotoSigningKey = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64');
  const atprotoSessionKey = Buffer.alloc(32, 7).toString('base64');

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
          APP_URL: origin,
          GITHUB_CLIENT_ID: 'test-client',
          GITHUB_CLIENT_SECRET: 'test-secret',
          ATPROTO_OAUTH_PRIVATE_KEY: atprotoSigningKey,
          ATPROTO_SESSION_KEY: atprotoSessionKey,
        },
        outboundService: async (request) => {
          outboundCalls++;
          const url = new URL(request.url);
          if (url.pathname === '/login/oauth/access_token') {
            expect(request.method).toBe('POST');
            const exchange = (await request.json()) as {
              code: string;
              client_secret: string;
              redirect_uri: string;
            };
            expect(exchange.client_secret).toBe('test-secret');
            expect(exchange.redirect_uri).toBe(`${origin}/auth/github/callback`);
            return Response.json(
              exchange.code === 'denied'
                ? { error: 'bad_verification_code' }
                : { access_token: 'test-github-access-token' },
            );
          }
          if (url.hostname === 'api.github.com' && url.pathname === '/user') {
            githubTokenWasServerSide =
              request.headers.get('Authorization') === 'Bearer test-github-access-token';
            return Response.json({
              id: 12345,
              login: githubUsername,
              name: 'Octo Runner',
              avatar_url: '',
              bio: 'A little movement.',
            });
          }
          throw new Error(`Unexpected external request: ${url.origin}${url.pathname}`);
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
        ].map((file) => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')),
      )
    ).join(';');
    for (const statement of migration
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  });

  afterAll(async () => {
    await runtime?.dispose();
  });

  it('only updates native AT Protocol profile fields that changed', () => {
    expect(
      atprotoProfileChanges('Bluesky name', 'Bluesky bio', 'Bluesky name', 'Bluesky bio'),
    ).toBeUndefined();
    expect(
      atprotoProfileChanges('Updated name', 'Bluesky bio', 'Bluesky name', 'Bluesky bio'),
    ).toEqual({ displayName: 'Updated name' });
    expect(
      atprotoProfileChanges('Bluesky name', 'Updated bio', 'Bluesky name', 'Bluesky bio'),
    ).toEqual({ description: 'Updated bio' });
  });

  async function begin() {
    const response = await runtime.dispatchFetch(`${origin}/auth/github`, { redirect: 'manual' });
    const url = new URL(response.headers.get('Location')!);
    const state = url.searchParams.get('state')!;
    return { response, url, state, cookie: `dwm_oauth_state=${state}` };
  }

  it('redirects to GitHub with basic identity permission and a secure state cookie', async () => {
    const { response, url, state } = await begin();
    expect(response.status).toBe(302);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('scope')).toBe('read:user');
    expect(url.searchParams.get('redirect_uri')).toBe(`${origin}/auth/github/callback`);
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get('Set-Cookie')).toContain(
      'HttpOnly; SameSite=Lax; Max-Age=600; Secure',
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(outboundCalls).toBe(0);
  });

  it('publishes AT Protocol OAuth metadata and only the signing key’s public material', async () => {
    const metadataResponse = await runtime.dispatchFetch(`${origin}/oauth/client-metadata.json`);
    const metadata = await metadataResponse.json<{
      client_id: string;
      redirect_uris: string[];
      scope: string;
      dpop_bound_access_tokens: boolean;
    }>();
    expect(metadataResponse.status).toBe(200);
    expect(metadata.client_id).toBe(`${origin}/oauth/client-metadata.json`);
    expect(metadata.redirect_uris).toEqual([`${origin}/auth/atproto/callback`]);
    expect(metadata.scope).toBe(ATPROTO_OAUTH_SCOPE);
    expect(metadata.dpop_bound_access_tokens).toBe(true);

    const jwksResponse = await runtime.dispatchFetch(`${origin}/oauth/jwks.json`);
    const jwks = await jwksResponse.json<{ keys: Record<string, unknown>[] }>();
    expect(jwksResponse.status).toBe(200);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(jwks.keys[0]).not.toHaveProperty('d');
    expect(JSON.stringify(jwks)).not.toContain(atprotoSigningKey);
  });

  it('uses the public loopback-client metadata for HTTP development origins', async () => {
    const client = await oauthClient({
      DB: db,
      APP_URL: 'http://localhost:8787',
      ATPROTO_OAUTH_PRIVATE_KEY: atprotoSigningKey,
      ATPROTO_SESSION_KEY: atprotoSessionKey,
    });
    expect(client.clientMetadata).toMatchObject({
      client_id:
        'http://localhost/?redirect_uri=http%3A%2F%2F127.0.0.1%3A8787%2Fauth%2Fatproto%2Fcallback&scope=atproto+repo%3Adev.devswhorun.activity+repo%3Adev.devswhorun.event+repo%3Adev.devswhorun.profile+repo%3Aapp.bsky.actor.profile',
      redirect_uris: ['http://127.0.0.1:8787/auth/atproto/callback'],
      scope: ATPROTO_OAUTH_SCOPE,
      token_endpoint_auth_method: 'none',
    });
    expect(client.clientMetadata).not.toHaveProperty('jwks_uri');
  });

  it('maps OAuth digest names to WebCrypto algorithm names', async () => {
    for (const name of ['sha256', 'sha384', 'sha512'] as const) {
      expect(webCryptoDigest(name)).toBe(`SHA-${name.slice(3)}`);
      await expect(
        crypto.subtle.digest(webCryptoDigest(name), new Uint8Array([1])),
      ).resolves.toBeInstanceOf(ArrayBuffer);
    }
  });

  it('accepts common AT Protocol secret formats and reports invalid keys as configuration errors', async () => {
    const env = {
      DB: db,
      APP_URL: origin,
      ATPROTO_OAUTH_PRIVATE_KEY: atprotoSigningKey,
      ATPROTO_SESSION_KEY: atprotoSessionKey,
    };
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    for (const signingKey of [pem, pem.replace(/\n/g, '\\n'), `"${atprotoSigningKey}"\n`])
      await expect(
        oauthClient({ ...env, ATPROTO_OAUTH_PRIVATE_KEY: signingKey }),
      ).resolves.toBeDefined();

    const sec1 = Buffer.from(privateKey.export({ type: 'sec1', format: 'pem' })).toString('base64');
    for (const [overrides, message] of [
      [{ ATPROTO_OAUTH_PRIVATE_KEY: sec1 }, 'SEC1'],
      [{ ATPROTO_OAUTH_PRIVATE_KEY: 'not*base64' }, 'not valid base64'],
      [{ ATPROTO_SESSION_KEY: Buffer.alloc(16).toString('base64') }, '32 bytes'],
    ] as const)
      await expect(oauthClient({ ...env, ...overrides })).rejects.toMatchObject({
        status: 503,
        message: expect.stringContaining(message),
      });
  });

  it('rejects missing or mismatched state before exchanging any GitHub code', async () => {
    const { state } = await begin();
    const missing = await runtime.dispatchFetch(
      `${origin}/auth/github/callback?code=ok&state=${state}`,
    );
    expect(missing.status).toBe(400);
    const mismatch = await runtime.dispatchFetch(
      `${origin}/auth/github/callback?code=ok&state=wrong`,
      {
        headers: { Cookie: `dwm_oauth_state=${state}` },
      },
    );
    expect(mismatch.status).toBe(400);
    expect(outboundCalls).toBe(0);
  });

  it('surfaces denied or failed authorisation without creating an account', async () => {
    const { state, cookie } = await begin();
    const denied = await runtime.dispatchFetch(
      `${origin}/auth/github/callback?error=access_denied&state=${state}`,
      { headers: { Cookie: cookie } },
    );
    expect(denied.status).toBe(400);
    const failed = await runtime.dispatchFetch(
      `${origin}/auth/github/callback?code=denied&state=${state}`,
      { headers: { Cookie: cookie } },
    );
    expect(failed.status).toBe(502);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM users').first()).toEqual({ count: 0 });
  });

  it('creates a private account and a hashed session without exposing the GitHub token', async () => {
    const { state, cookie } = await begin();
    const response = await runtime.dispatchFetch(
      `${origin}/auth/github/callback?code=ok&state=${state}`,
      {
        headers: { Cookie: cookie },
        redirect: 'manual',
      },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`${origin}/?welcome=1`);
    expect(githubTokenWasServerSide).toBe(true);
    const cookies = response.headers.getSetCookie();
    const sessionCookie = cookies.find((value) => value.startsWith('dwm_session='))!;
    expect(sessionCookie).toContain('HttpOnly; SameSite=Lax; Max-Age=2592000; Secure');
    expect(cookies.find((value) => value.startsWith('dwm_oauth_state='))).toContain('Max-Age=0');
    expect(JSON.stringify([...response.headers])).not.toContain('test-github-access-token');
    const rawSession = sessionCookie.split(';')[0].split('=')[1];
    const stored = await db
      .prepare('SELECT token_hash FROM sessions')
      .first<{ token_hash: string }>();
    expect(stored?.token_hash).toBe(createHash('sha256').update(rawSession).digest('hex'));
    expect(stored?.token_hash).not.toBe(rawSession);
    const bootstrap = await runtime.dispatchFetch(`${origin}/api/bootstrap`, {
      headers: { Cookie: `dwm_session=${rawSession}` },
    });
    expect(await bootstrap.json()).toMatchObject({
      viewer: { username: 'octo-runner', name: 'Octo Runner', visibility: 'private' },
      githubConfigured: true,
    });
  });

  it('matches returning users by immutable GitHub ID and preserves customised profiles', async () => {
    await db
      .prepare(
        "UPDATE users SET name = 'Custom name', bio = 'My bio', visibility = 'public' WHERE github_id = 12345",
      )
      .run();
    githubUsername = 'new-github-handle';
    const { state, cookie } = await begin();
    expect(
      (
        await runtime.dispatchFetch(`${origin}/auth/github/callback?code=ok&state=${state}`, {
          headers: { Cookie: cookie },
          redirect: 'manual',
        })
      ).status,
    ).toBe(302);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM users').first()).toEqual({ count: 1 });
    expect(await db.prepare('SELECT username, name, bio, visibility FROM users').first()).toEqual({
      username: 'new-github-handle',
      name: 'Custom name',
      bio: 'My bio',
      visibility: 'public',
    });
  });
});
