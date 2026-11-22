import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerModules } from './testing/bundle';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

describe('Developer insights API authorization', () => {
  let runtime: Miniflare;
  const origin = 'http://localhost:8787';
  const session = 'a'.repeat(64);
  const readToken = `dwm_${'b'.repeat(64)}`;
  const writeToken = `dwm_${'c'.repeat(64)}`;
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');

  beforeAll(async () => {
    const bundle = await workerModules();
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        ...bundle,
        compatibilityDate: '2026-11-03',
        compatibilityFlags: ['nodejs_compat'],
        bindings: { APP_URL: origin },
        d1Databases: ['DB'],
        r2Buckets: ['PHOTOS'],
        outboundService: () => new Response('GitHub unavailable in tests', { status: 503 }),
      }),
    );
    const db = await runtime.getD1Database('DB');
    for (const name of (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      const migration = await readFile(`migrations/${name}`, 'utf8');
      await db.exec(migration.replace(/--[^\n]*/g, '').replace(/\n/g, ' '));
    }
    await db
      .prepare(
        `INSERT INTO users (id, github_id, username, name) VALUES ('owner', 1, 'owner', 'Owner')`,
      )
      .run();
    await db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(hash(session), 'owner', '2099-01-01T00:00:00.000Z')
      .run();
    for (const [id, token, scopes] of [
      ['read', readToken, ['activities:read']],
      ['write', writeToken, ['activities:write']],
    ] as const) {
      await db
        .prepare(
          `INSERT INTO agent_tokens
         (id, user_id, token_hash, name, scopes, created_at, expires_at)
         VALUES (?, 'owner', ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          hash(token),
          id,
          JSON.stringify(scopes),
          '2026-01-01T00:00:00.000Z',
          '2099-01-01T00:00:00.000Z',
        )
        .run();
    }
  });

  afterAll(async () => {
    await runtime?.dispose();
  });

  const request = (path: string, headers: Record<string, string> = {}) =>
    runtime.dispatchFetch(`${origin}${path}`, { headers });

  it('requires authentication for both insight endpoints', async () => {
    for (const path of [
      '/api/insights/weekly',
      '/api/insights/github',
      '/api/insights/code-movement',
      '/api/insights/recap?type=monthly',
      '/api/insights/recap/card.png?type=monthly',
    ]) {
      expect((await request(path)).status).toBe(401);
    }
  });

  it('returns the owner weekly summary to a browser session and a read-scoped agent', async () => {
    for (const headers of [
      { Cookie: `dwm_session=${session}` },
      { Authorization: `Bearer ${readToken}` },
    ]) {
      const response = await request('/api/insights/weekly', headers);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        current: { sessions: number; minutes: number; distanceKm: number };
        summary: string;
      };
      expect(body.current).toMatchObject({ sessions: 0, minutes: 0, distanceKm: 0 });
      expect(body.summary).toBeTypeOf('string');
    }
  });

  it('does not grant weekly access to a write-only token', async () => {
    expect(
      (
        await request('/api/insights/weekly', {
          Authorization: `Bearer ${writeToken}`,
        })
      ).status,
    ).toBe(403);
  });

  it('keeps GitHub comparison and challenge browser-only', async () => {
    for (const path of [
      '/api/insights/github',
      '/api/insights/code-movement',
      '/api/insights/recap?type=monthly',
      '/api/insights/recap/card.png?type=monthly',
    ]) {
      expect(
        (
          await request(path, {
            Authorization: `Bearer ${readToken}`,
          })
        ).status,
      ).toBe(403);
    }
  });

  it('renders a private monthly digest card for the owner even when GitHub is unavailable', async () => {
    const cookie = { Cookie: `dwm_session=${session}` };
    const digest = await request('/api/insights/recap?type=monthly', cookie);
    expect(digest.status).toBe(200);
    expect(await digest.json()).toMatchObject({ kind: 'monthly', commits: null });
    const card = await request('/api/insights/recap/card.png?type=monthly', cookie);
    expect(card.status).toBe(200);
    expect(card.headers.get('Content-Type')).toBe('image/png');
    expect(card.headers.get('Cache-Control')).toBe('private, no-store');
    expect([...new Uint8Array(await card.arrayBuffer()).slice(1, 4)]).toEqual([80, 78, 71]);
    expect((await request('/api/insights/recap?type=monthly&month=bad', cookie)).status).toBe(400);
  });

  it('never falls back from an invalid bearer token to a valid browser cookie', async () => {
    expect(
      (
        await request('/api/insights/weekly', {
          Authorization: 'Bearer invalid',
          Cookie: `dwm_session=${session}`,
        })
      ).status,
    ).toBe(401);
  });

  it('lets the MCP recap tool dispatch to the authenticated weekly endpoint', async () => {
    const response = await runtime.dispatchFetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'get_weekly_recap',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'weekly-recap',
        method: 'tools/call',
        params: {
          name: 'get_weekly_recap',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'Insights test', version: '1.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { isError: boolean; structuredContent: { current: { sessions: number } } };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.current.sessions).toBe(0);
  });
});
