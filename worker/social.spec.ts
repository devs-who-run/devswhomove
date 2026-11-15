import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

describe('Social API', () => {
  let runtime: Miniflare;
  let db: D1Database;
  const origin = 'http://localhost:8787';
  const sessions = { alice: 'a'.repeat(64), bob: 'b'.repeat(64), carol: 'c'.repeat(64) };
  const agentToken = `dwm_${'d'.repeat(64)}`;
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');

  beforeAll(async () => {
    const bundle = await build({
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
        script: bundle.outputFiles[0].text,
        compatibilityDate: '2026-11-03',
        compatibilityFlags: ['nodejs_compat'],
        bindings: { APP_URL: origin },
        d1Databases: ['DB'],
        r2Buckets: ['PHOTOS'],
      }),
    );
    db = (await runtime.getD1Database('DB')) as unknown as D1Database;
    for (const name of (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      const migration = await readFile(`migrations/${name}`, 'utf8');
      await db.exec(migration.replace(/--[^\n]*/g, '').replace(/\n/g, ' '));
    }
    const users = [
      ['alice', 1, 'public'],
      ['bob', 2, 'public'],
      ['carol', 3, 'private'],
    ] as const;
    for (const [id, githubId, visibility] of users) {
      await db
        .prepare(
          'INSERT INTO users (id, github_id, username, name, visibility) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, githubId, id, id.toUpperCase(), visibility)
        .run();
      await db
        .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(hash(sessions[id]), id, '2099-01-01T00:00:00.000Z')
        .run();
    }
    const activities = [
      ['alice-run', 'alice', 'public', '2026-05-03T07:00:00.000Z'],
      ['alice-secret', 'alice', 'private', '2026-05-02T07:00:00.000Z'],
      ['bob-ride', 'bob', 'public', '2026-05-01T07:00:00.000Z'],
      ['carol-swim', 'carol', 'public', '2026-04-30T07:00:00.000Z'],
    ] as const;
    for (const [id, userId, visibility, occurredAt] of activities) {
      await db
        .prepare(
          `INSERT INTO activities (id, user_id, title, sport, occurred_at, duration, visibility, source, payload_hash)
          VALUES (?, ?, ?, 'Running', ?, 30, ?, 'web', 'hash')`,
        )
        .bind(id, userId, id, occurredAt, visibility)
        .run();
    }
    await db
      .prepare(
        `INSERT INTO agent_tokens (id, user_id, token_hash, name, scopes, created_at, expires_at)
        VALUES ('agent', 'alice', ?, 'agent', ?, ?, ?)`,
      )
      .bind(
        hash(agentToken),
        JSON.stringify(['activities:read', 'activities:write', 'events:read']),
        '2026-01-01T00:00:00.000Z',
        '2099-01-01T00:00:00.000Z',
      )
      .run();
  });

  afterAll(async () => {
    await runtime?.dispose();
  });

  type User = keyof typeof sessions;
  const call = async <T = Record<string, unknown>>(
    path: string,
    { as, method = 'GET', data }: { as?: User; method?: string; data?: unknown } = {},
  ) => {
    const headers: Record<string, string> = {};
    if (as) headers['Cookie'] = `dwm_session=${sessions[as]}`;
    if (method !== 'GET') headers['Origin'] = origin;
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const response = await runtime.dispatchFetch(`${origin}${path}`, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: (await response.json()) as T };
  };

  it('gives kudos to public activities from public profiles only', async () => {
    const given = await call('/api/activities/alice-run/kudos', {
      as: 'bob',
      method: 'POST',
      data: { kudos: true },
    });
    expect(given).toMatchObject({ status: 200, body: { kudos: 1, kudoed: true } });
    expect(
      (
        await call('/api/activities/alice-run/kudos', {
          as: 'alice',
          method: 'POST',
          data: { kudos: true },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('/api/activities/alice-run/kudos', {
          as: 'carol',
          method: 'POST',
          data: { kudos: true },
        })
      ).status,
    ).toBe(403);
    for (const id of ['alice-secret', 'carol-swim']) {
      expect(
        (
          await call(`/api/activities/${id}/kudos`, {
            as: 'bob',
            method: 'POST',
            data: { kudos: true },
          })
        ).status,
      ).toBe(404);
    }
    const feed = await call<{ activities: { id: string; kudos: number; kudoed: boolean }[] }>(
      '/api/bootstrap',
      { as: 'bob' },
    );
    expect(feed.body.activities.find((item) => item.id === 'alice-run')).toMatchObject({
      kudos: 1,
      kudoed: true,
    });
  });

  it('lets public profiles comment and lets authors or owners delete comments', async () => {
    expect(
      (
        await call('/api/activities/alice-run/comments', {
          as: 'carol',
          method: 'POST',
          data: { body: 'hi' },
        })
      ).status,
    ).toBe(403);
    const created = await call<{ comment: { id: string; canDelete: boolean } }>(
      '/api/activities/alice-run/comments',
      { as: 'bob', method: 'POST', data: { body: 'Great pace!' } },
    );
    expect(created.status).toBe(201);
    expect(created.body.comment.canDelete).toBe(true);
    const listed = await call<{ comments: { body: string; author: { username: string } }[] }>(
      '/api/activities/alice-run/comments',
    );
    expect(listed.body.comments).toEqual([
      expect.objectContaining({
        body: 'Great pace!',
        author: expect.objectContaining({ username: 'bob' }),
      }),
    ]);
    expect(
      (
        await call(`/api/activities/alice-run/comments/${created.body.comment.id}`, {
          as: 'carol',
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`/api/activities/alice-run/comments/${created.body.comment.id}`, {
          as: 'alice',
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect((await call('/api/activities/alice-secret/comments')).status).toBe(404);
  });

  it('hides social data from people who make their profile private', async () => {
    await call('/api/activities/bob-ride/comments', {
      as: 'alice',
      method: 'POST',
      data: { body: 'Nice ride' },
    });
    await db.prepare(`UPDATE users SET visibility = 'private' WHERE id = 'alice'`).run();
    const listed = await call<{ comments: unknown[] }>('/api/activities/bob-ride/comments');
    expect(listed.body.comments).toEqual([]);
    await db.prepare(`UPDATE users SET visibility = 'public' WHERE id = 'alice'`).run();
  });

  it('follows public people and filters the following feed', async () => {
    expect((await call('/api/feed?scope=following')).status).toBe(401);
    expect(
      (
        await call('/api/follows', {
          as: 'alice',
          method: 'POST',
          data: { userId: 'carol', follow: true },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('/api/follows', {
          as: 'alice',
          method: 'POST',
          data: { userId: 'alice', follow: true },
        })
      ).status,
    ).toBe(400);
    const followed = await call('/api/follows', {
      as: 'alice',
      method: 'POST',
      data: { userId: 'bob', follow: true },
    });
    expect(followed.body).toMatchObject({ followers: 1, viewerFollows: true });
    const feed = await call<{ activities: { id: string }[] }>('/api/feed?scope=following', {
      as: 'alice',
    });
    expect(feed.body.activities.map((item) => item.id)).toEqual(['bob-ride']);
    const profile = await call<{ social: { followers: number; viewerFollows: boolean } }>(
      '/api/profiles/bob',
      { as: 'alice' },
    );
    expect(profile.body.social).toMatchObject({ followers: 1, viewerFollows: true });
  });

  it('runs open clubs with their own feed and member-only events', async () => {
    expect(
      (await call('/api/clubs', { as: 'carol', method: 'POST', data: { name: 'Private club' } }))
        .status,
    ).toBe(403);
    const created = await call<{ club: { id: string; slug: string; members: number } }>(
      '/api/clubs',
      { as: 'alice', method: 'POST', data: { name: 'Angular devs who run', sport: 'Running' } },
    );
    expect(created.status).toBe(201);
    expect(created.body.club).toMatchObject({ slug: 'angular-devs-who-run', members: 1 });
    const { id: clubId, slug } = created.body.club;
    const event = {
      title: 'Club 5K',
      sport: 'Running',
      startsAt: '2099-06-01T07:00:00.000Z',
      location: 'Park',
      level: 'All levels',
      capacity: 10,
      clubId,
    };
    expect((await call('/api/events', { as: 'bob', method: 'POST', data: event })).status).toBe(
      403,
    );
    expect(
      (
        await call(`/api/clubs/${slug}/membership`, {
          as: 'bob',
          method: 'POST',
          data: { join: true },
        })
      ).body,
    ).toMatchObject({ club: { joined: true, members: 2 } });
    expect((await call('/api/events', { as: 'bob', method: 'POST', data: event })).status).toBe(
      201,
    );
    const detail = await call<{
      members: { username: string }[];
      activities: { id: string }[];
      events: { title: string; clubSlug: string }[];
    }>(`/api/clubs/${slug}`);
    expect(detail.body.members.map((member) => member.username)).toEqual(['alice', 'bob']);
    expect(detail.body.activities.map((item) => item.id)).toEqual(['alice-run', 'bob-ride']);
    expect(detail.body.events).toEqual([
      expect.objectContaining({ title: 'Club 5K', clubSlug: slug }),
    ]);
    expect(
      (
        await call(`/api/clubs/${slug}/membership`, {
          as: 'alice',
          method: 'POST',
          data: { join: false },
        })
      ).status,
    ).toBe(400);
    expect((await call(`/api/clubs/${slug}`, { as: 'bob', method: 'DELETE' })).status).toBe(403);
    expect((await call(`/api/clubs/${slug}`, { as: 'alice', method: 'DELETE' })).status).toBe(200);
    expect((await call(`/api/clubs/${slug}`)).status).toBe(404);
  });

  it('rejects agent tokens on social endpoints', async () => {
    const response = await runtime.dispatchFetch(`${origin}/api/activities/bob-ride/kudos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kudos: true }),
    });
    expect(response.status).toBe(403);
    const clubs = await runtime.dispatchFetch(`${origin}/api/clubs`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(clubs.status).toBe(403);
  });
});
