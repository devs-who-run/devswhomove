import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { getGithubInsights, getWeeklyRecap, insightsPeriods } from './insights';
import { HttpError } from './validation';

const now = new Date('2026-11-15T12:00:00.000Z');
const github = { user: { id: 'alice', username: 'alice/name' }, provider: 'github' as const };
const atproto = {
  user: { id: 'did:plc:alice', username: 'alice.example' },
  provider: 'atproto' as const,
};

describe('Weekly insights with real D1', () => {
  let runtime: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response("ok"); } };',
        compatibilityDate: '2026-11-03',
        d1Databases: ['DB'],
      }),
    );
    db = (await runtime.getD1Database('DB')) as unknown as D1Database;
    for (const file of ['0001_initial.sql', '0003_atproto.sql']) {
      const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
      for (const statement of migration
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean))
        await db.prepare(statement).run();
    }
    await db.batch([
      db
        .prepare('INSERT INTO users (id, github_id, username, name) VALUES (?, ?, ?, ?)')
        .bind('alice', 1, 'alice', 'Alice'),
      db
        .prepare('INSERT INTO users (id, github_id, username, name) VALUES (?, ?, ?, ?)')
        .bind('bob', 2, 'bob', 'Bob'),
      db
        .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
        .bind(atproto.user.id, 'alice.example', 'Alice', now.toISOString()),
      db
        .prepare('INSERT INTO atproto_accounts (did, handle, name, updated_at) VALUES (?, ?, ?, ?)')
        .bind('did:plc:bob', 'bob.example', 'Bob', now.toISOString()),
    ]);
  });
  afterAll(async () => {
    await runtime?.dispose();
  });
  beforeEach(async () => {
    await db.batch([
      db.prepare('DELETE FROM activities'),
      db.prepare('DELETE FROM atproto_activities'),
    ]);
  });

  const activity = (
    id: string,
    date: string,
    owner = 'alice',
    sport = 'Running',
    distance: number | null = 1.2,
  ) =>
    db
      .prepare(
        `INSERT INTO activities
      (id, user_id, title, sport, occurred_at, duration, distance, notes, visibility, source, payload_hash)
      VALUES (?, ?, 'Sensitive title', ?, ?, 10, ?, 'Sensitive notes', 'private', 'web', 'hash')`,
      )
      .bind(id, owner, sport, date, distance);

  it('uses the last completed UTC Monday–Sunday on Sunday and at the Monday rollover', () => {
    expect(insightsPeriods(now)).toEqual({
      period: { start: '2026-11-02', end: '2026-11-08' },
      previousPeriod: { start: '2026-10-26', end: '2026-11-01' },
    });
    expect(insightsPeriods(new Date('2026-11-09T00:00:00.000Z'))).toEqual(insightsPeriods(now));
    expect(insightsPeriods(new Date('2026-11-16T00:00:00.000Z')).period).toEqual({
      start: '2026-11-09',
      end: '2026-11-15',
    });
    expect(insightsPeriods(new Date('2027-01-04T00:00:00.000Z')).period).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
    });
  });

  it('aggregates over 100 own private sessions, isolates owners, and respects both period edges', async () => {
    await db.batch([
      ...Array.from({ length: 105 }, (_, i) =>
        activity(`current-${i}`, '2026-11-02T00:00:00.000Z'),
      ),
      activity('last', '2026-11-08T23:59:59.999Z', 'alice', 'Walking', null),
      activity('previous-first', '2026-10-26T00:00:00.000Z'),
      activity('previous-last', '2026-11-01T23:59:59.999Z'),
      activity('outside-old', '2026-10-25T23:59:59.999Z'),
      activity('outside-new', '2026-11-09T00:00:00.000Z'),
      activity('bob', '2026-11-02T00:00:00.000Z', 'bob'),
    ]);
    const result = await getWeeklyRecap(db, github, { now });
    expect(result.current).toEqual({
      sessions: 106,
      minutes: 1060,
      distanceKm: 126,
      activeDays: 2,
      bySport: [
        { sport: 'Running', sessions: 105, minutes: 1050, distanceKm: 126 },
        { sport: 'Walking', sessions: 1, minutes: 10, distanceKm: 0 },
      ],
    });
    expect(result.previous).toMatchObject({
      sessions: 2,
      minutes: 20,
      distanceKm: 2.4,
      activeDays: 2,
    });
    expect(result.summary).toContain('2026-11-02–2026-11-08 (UTC): 106 sessions');
    expect(result.summary).toContain('2 active days');
    expect(result.coverage).toContain('including private');
    expect(JSON.stringify(result)).not.toMatch(/Sensitive|alice|notes|title/);
  });

  it('validates indexed AT Protocol projections, skips malformed JSON, and isolates DIDs', async () => {
    const record = {
      sport: 'Cycling',
      occurredAt: '2026-11-09T00:30:00+01:00',
      duration: 30,
      distance: 5.5,
      notes: 'Private notes',
      title: 'Private title',
    };
    const records: unknown[] = [
      record,
      { ...record, occurredAt: '2026-10-26T08:00:00Z', distance: undefined },
      { ...record, sport: 'Hacking' },
      { ...record, duration: '30' },
      { ...record, distance: -2 },
      { ...record, occurredAt: '2026' },
      { ...record, occurredAt: '2026-02-30T00:00:00Z' },
      { ...record, duration: 1500 },
      [],
    ];
    await db.batch([
      ...records.map((entry, i) =>
        db
          .prepare(
            'INSERT INTO atproto_activities (uri, did, rkey, record_json, indexed_at) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(
            `at://alice/${i}`,
            atproto.user.id,
            `${i}`,
            JSON.stringify(entry),
            now.toISOString(),
          ),
      ),
      db
        .prepare('INSERT INTO atproto_activities VALUES (?, ?, ?, ?, ?)')
        .bind('at://alice/bad', atproto.user.id, 'bad', '{invalid json', now.toISOString()),
      db
        .prepare('INSERT INTO atproto_activities VALUES (?, ?, ?, ?, ?)')
        .bind('at://bob/1', 'did:plc:bob', '1', JSON.stringify(record), now.toISOString()),
    ]);
    const result = await getWeeklyRecap(db, atproto, { now });
    expect(result.current).toMatchObject({
      sessions: 1,
      minutes: 30,
      distanceKm: 5.5,
      activeDays: 1,
    });
    expect(result.previous).toMatchObject({ sessions: 1, distanceKm: 0 });
    expect(result.summary).toContain('1 session');
    expect(result.summary).toContain('1 active day');
    expect(result.coverage).toContain('indexed in D1 only');
    expect(result.coverage).toContain('Excluded 8 malformed');
    expect(JSON.stringify(result)).not.toMatch(/Private notes|Private title/);
  });

  it.each([github, atproto])('reports factual zero weeks for $provider', async (identity) => {
    const recap = await getWeeklyRecap(db, identity, { now });
    expect(recap.current).toEqual({
      sessions: 0,
      minutes: 0,
      distanceKm: 0,
      activeDays: 0,
      bySport: [],
    });
    expect(recap.previous).toEqual(recap.current);
    expect(recap.summary).toContain('0 sessions');
    expect(recap.summary).not.toMatch(/NaN|Infinity/);
  });
});

describe('Public GitHub development insights', () => {
  const db = {} as D1Database;
  const push = (
    id: string,
    created_at = '2026-11-04T12:00:00Z',
    payload: unknown = { size: 3 },
  ) => ({ id, type: 'PushEvent', created_at, payload });
  const fetchPages = (...pages: unknown[]) =>
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        new URL(String(input)).pathname === '/search/commits'
          ? Response.json({ total_count: 7, incomplete_results: false })
          : Response.json(pages.shift()),
      );

  it('counts public authored commits separately from push-event payloads', async () => {
    const fetch = fetchPages([
      push('1', undefined, { commits: [{ sha: 'one' }] }),
      push('2', undefined, {}),
      push('3'),
      push('4', undefined, { size: '3' }),
    ]);
    const result = await getGithubInsights(db, github, { now, fetch });
    expect(result).toMatchObject({ pushEvents: 4, commits: 7, complete: false });
    expect(result.coverage).toContain('authored during the week on default branches');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain(
      'users/alice%2Fname/events/public?per_page=100&page=1',
    );
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devs-who-move-insights',
    });
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    expect(fetch.mock.calls[0][1]?.signal).toBeDefined();
    const search = new URL(String(fetch.mock.calls[1][0]));
    expect(search.pathname).toBe('/search/commits');
    expect(search.searchParams.get('q')).toBe(
      'author:alice/name author-date:2026-11-02T00:00:00Z..2026-11-08T23:59:59Z is:public',
    );
    expect(search.searchParams.get('per_page')).toBe('1');
    expect(fetch.mock.calls[1][1]?.headers).not.toHaveProperty('Authorization');
  });

  it('paginates, deduplicates IDs, and stops once the historical boundary is covered', async () => {
    const fetch = fetchPages(
      Array.from({ length: 100 }, (_, i) => push(`${i}`)),
      [push('99'), push('100', '2026-11-08T23:59:59Z'), push('outside', '2026-11-01T23:59:59Z')],
    );
    const result = await getGithubInsights(db, github, { now, fetch });
    expect(result).toMatchObject({ pushEvents: 101, commits: 7, complete: false });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][0]).toContain('page=2');
  });

  it('stops within a full page when it contains older history, and excludes current-week/non-push events', async () => {
    const fetch = fetchPages([
      push('new', '2026-11-09T00:00:00Z'),
      push('start', '2026-11-02T00:00:00Z'),
      { ...push('issue'), type: 'IssuesEvent' },
      ...Array.from({ length: 97 }, (_, i) => push(`old-${i}`, '2026-11-01T12:00:00Z')),
    ]);
    const result = await getGithubInsights(db, github, { now, fetch });
    expect(result).toMatchObject({ pushEvents: 1, commits: 7 });
    expect(result.period).toEqual(insightsPeriods(now).period);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetches at most 300 events and labels truncation', async () => {
    const fetch = fetchPages(
      ...Array.from({ length: 3 }, (_, page) =>
        Array.from({ length: 100 }, (_, i) => push(`${page}-${i}`)),
      ),
    );
    const result = await getGithubInsights(db, github, { now, fetch });
    expect(result.pushEvents).toBe(300);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.coverage).toContain('weekly push totals may be partial');
    expect(result.complete).toBe(false);
  });

  it('keeps public commit search distinct when available push history is empty', async () => {
    const result = await getGithubInsights(db, github, { now, fetch: fetchPages([]) });
    expect(result).toMatchObject({ pushEvents: 0, commits: 7, complete: false });
    expect(result.coverage).toContain('exclude private repositories');
  });

  it('labels an incomplete GitHub search result as potentially partial', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) =>
        new URL(String(input)).pathname === '/search/commits'
          ? Response.json({ total_count: 5, incomplete_results: true })
          : Response.json([]),
      );
    const result = await getGithubInsights(db, github, { now, fetch });
    expect(result.commits).toBe(5);
    expect(result.coverage).toContain('GitHub reported incomplete search results');
  });

  it('fails explicitly when public commit search is rate limited', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) =>
        new URL(String(input)).pathname === '/search/commits'
          ? new Response('', { status: 403 })
          : Response.json([]),
      );
    await expect(getGithubInsights(db, github, { now, fetch })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('public commit search API failed (HTTP 403)'),
    });
  });

  it.each([
    {},
    { total_count: -1, incomplete_results: false },
    { total_count: 1, incomplete_results: 'false' },
  ])('rejects malformed commit search responses', async (search) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) =>
        new URL(String(input)).pathname === '/search/commits'
          ? Response.json(search)
          : Response.json([]),
      );
    await expect(getGithubInsights(db, github, { now, fetch })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('invalid search data'),
    });
  });

  it.each([403, 429, 500])(
    'fails explicitly for GitHub HTTP %s instead of fabricating totals',
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response('', { status }));
      await expect(getGithubInsights(db, github, { now, fetch })).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining(`${status}`),
      });
    },
  );

  it.each([{}, [push('bad', 'not a date')], [null]])(
    'rejects malformed responses',
    async (page) => {
      await expect(
        getGithubInsights(db, github, { now, fetch: fetchPages(page) }),
      ).rejects.toMatchObject({ status: 502 });
    },
  );

  it('maps fetch timeouts/network failures and invalid JSON to explicit 502 errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('timeout'));
    await expect(getGithubInsights(db, github, { now, fetch })).rejects.toMatchObject({
      status: 502,
    });
    fetch.mockResolvedValue(new Response('invalid json'));
    await expect(getGithubInsights(db, github, { now, fetch })).rejects.toBeInstanceOf(HttpError);
  });

  it('rejects AT Protocol identities without contacting GitHub', async () => {
    const fetch = fetchPages([]);
    await expect(getGithubInsights(db, atproto, { now, fetch })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
