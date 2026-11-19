import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { workerModules } from './testing/bundle';

describe('deployed asset routing', () => {
  const origin = 'http://localhost:8787';
  const staticHtml = '<!doctype html><html><head><title>Static</title></head><body></body></html>';
  let assetsDirectory: string;
  let runtime: Miniflare;

  beforeAll(async () => {
    const config = unstable_readConfig({ config: 'wrangler.jsonc' });
    const assets = config.assets;
    if (!assets?.binding || !assets.not_found_handling) {
      throw new Error('Wrangler assets binding and SPA fallback must be configured');
    }

    assetsDirectory = await mkdtemp(join(tmpdir(), 'devs-who-move-assets-'));
    await Promise.all([
      copyFile('src/index.html', join(assetsDirectory, 'index.html')),
      copyFile('public/og-image.png', join(assetsDirectory, 'og-image.png')),
      copyFile('public/llms.txt', join(assetsDirectory, 'llms.txt')),
      copyFile('public/_redirects', join(assetsDirectory, '_redirects')),
      writeFile(join(assetsDirectory, 'static.html'), staticHtml),
      writeFile(join(assetsDirectory, 'asset.js'), 'const asset = true;'),
    ]);

    runtime = new Miniflare(
      convertV4MiniflareOptions({
        ...(await workerModules()),
        compatibilityDate: config.compatibility_date,
        assets: {
          directory: assetsDirectory,
          binding: assets.binding,
          run_worker_first: assets.run_worker_first,
          routerConfig: { has_user_worker: true },
          assetConfig: { not_found_handling: assets.not_found_handling },
        },
        d1Databases: ['DB'],
        bindings: { APP_URL: origin },
      }),
    );

    const db = await runtime.getD1Database('DB');
    for (const migration of [
      '0001_initial.sql',
      '0002_activity_photos.sql',
      '0008_rate_limits.sql',
    ]) {
      const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
      for (const statement of sql
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    await db
      .prepare(
        'INSERT INTO users (id, github_id, username, name, visibility) VALUES (?, ?, ?, ?, ?)',
      )
      .bind('runner', 1, 'runner', 'Runner', 'public')
      .run();
    for (const visibility of ['public', 'private']) {
      await db
        .prepare(
          `INSERT INTO activities
            (id, user_id, title, sport, occurred_at, duration, distance, visibility, source, payload_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `${visibility}-run`,
          'runner',
          `${visibility} run`,
          'Running',
          '2026-01-01T08:00:00.000Z',
          30,
          5,
          visibility,
          'web',
          'hash',
        )
        .run();
    }
  });

  afterAll(async () => {
    await runtime?.dispose();
    if (assetsDirectory) await rm(assetsDirectory, { recursive: true, force: true });
  });

  it.each([
    '/',
    '/?welcome=1',
    '/feed',
    '/feed/',
    '/events',
    '/events/',
    '/clubs',
    '/clubs/',
    '/clubs/early-runners',
    '/profile',
    '/profile/',
    '/profile/alice',
    '/agents',
    '/agents/',
  ])('adds the default social image to %s', async (path) => {
    const response = await runtime.dispatchFetch(`${origin}${path}`, {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<meta property="og:image" content="${origin}/og-image.png" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${origin}/og-image.png" />`);
  });

  it.each([
    { path: '/?source=share', canonical: '/' },
    { path: '/profile/alice', canonical: '/profile/alice' },
    { path: '/profile/did%3Aplc%3Aexample', canonical: '/profile/did%3Aplc%3Aexample' },
    { path: '/profile/alice&bob', canonical: '/profile/alice%26bob' },
  ])('serves complete social previews for $path', async ({ path, canonical }) => {
    const response = await runtime.dispatchFetch(`${origin}${path}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain(
      '<meta property="og:title" content="Devs Who Move - Your people. Your pace." />',
    );
    expect(html).toContain(`<meta property="og:url" content="${origin}${canonical}" />`);
    expect(html).toContain(`<meta property="og:image" content="${origin}/og-image.png" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${origin}/og-image.png" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('serves the shared brand image as a 1200 by 630 PNG', async () => {
    const response = await runtime.dispatchFetch(`${origin}/og-image.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    const bytes = await response.arrayBuffer();
    expect([...new Uint8Array(bytes, 0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const dimensions = new DataView(bytes, 16, 8);
    expect([dimensions.getUint32(0), dimensions.getUint32(4)]).toEqual([1200, 630]);
  });

  it('serves the agent guide at the standard path and redirects the requested alias', async () => {
    const alias = await runtime.dispatchFetch(`${origin}/llm.txt`, { redirect: 'manual' });
    expect(alias.status).toBe(301);
    expect(alias.headers.get('location')).toBe('/llms.txt');
    const guide = await runtime.dispatchFetch(`${origin}/llms.txt`);
    expect(guide.status).toBe(200);
    expect(guide.headers.get('content-type')).toContain('text/plain');
    const text = await guide.text();
    expect(text).toContain('# Devs Who Move');
    expect(text).toContain('https://github.com/devs-who-run/devswhomove/blob/main/README.md');
  });

  it('handles HEAD requests and redirects the index file to the home page', async () => {
    const head = await runtime.dispatchFetch(`${origin}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toContain('text/html');
    expect(await head.text()).toBe('');

    const index = await runtime.dispatchFetch(`${origin}/index.html`, { redirect: 'manual' });
    expect(index.status).toBe(307);
    expect(index.headers.get('location')).toBe('/');
  });

  it('leaves unrelated static assets unmodified', async () => {
    expect(await (await runtime.dispatchFetch(`${origin}/static.html`)).text()).toBe(staticHtml);
    expect(await (await runtime.dispatchFetch(`${origin}/asset.js`)).text()).toBe(
      'const asset = true;',
    );
  });

  it('continues routing API requests to the Worker', async () => {
    const response = await runtime.dispatchFetch(`${origin}/api/not-a-route`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Endpoint not found.' });
  });

  it('keeps activity-specific previews and private pages separate from the default image', async () => {
    const publicPage = await runtime.dispatchFetch(`${origin}/activities/public-run`);
    const html = await publicPage.text();
    expect(publicPage.status, html).toBe(200);
    expect(html).toContain(
      `<meta property="og:image" content="${origin}/api/activities/public-run/card.png?v=`,
    );
    expect(html).not.toContain('/og-image.png');

    const slashPage = await runtime.dispatchFetch(`${origin}/activities/public-run/`, {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
    });
    expect(await slashPage.text()).toContain(
      `<meta property="og:image" content="${origin}/api/activities/public-run/card.png?v=`,
    );

    const privatePage = await runtime.dispatchFetch(`${origin}/activities/private-run`);
    expect(privatePage.status).toBe(200);
    expect(await privatePage.text()).not.toContain('og:image');
  });
});
