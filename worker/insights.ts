import { SPORTS, type Sport } from '../src/app/models';
import type {
  ActivityTotals,
  CodeMovementChallenge,
  GithubInsights,
  InsightsPeriod,
  PeriodRecap,
  WeeklyRecap,
} from '../src/app/insights.models';
import { completedMonths, monthlyPeriod, wrappedPeriod } from '../src/app/recap-period';
import { HttpError } from './validation';

export interface InsightsIdentity {
  user: { id: string; username: string };
  provider: 'github' | 'atproto';
}

export interface InsightsOptions {
  now?: Date;
  fetch?: typeof fetch;
}

const DAY = 86_400_000;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'devs-who-move-insights',
};

export function insightsPeriods(now = new Date()): {
  period: InsightsPeriod;
  previousPeriod: InsightsPeriod;
} {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return {
    period: {
      start: isoDate(new Date(monday.getTime() - 7 * DAY)),
      end: isoDate(new Date(monday.getTime() - DAY)),
    },
    previousPeriod: {
      start: isoDate(new Date(monday.getTime() - 14 * DAY)),
      end: isoDate(new Date(monday.getTime() - 8 * DAY)),
    },
  };
}

const endExclusive = (period: InsightsPeriod) =>
  new Date(Date.parse(`${period.end}T00:00:00Z`) + DAY).toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface Projection {
  sport: Sport;
  occurredAt: string;
  duration: number;
  distance: number | null;
}

function projection(value: unknown): Projection | null {
  if (!isRecord(value)) return null;
  const { sport, occurredAt, duration, distance } = value;
  if (
    !SPORTS.includes(sport as Sport) ||
    typeof occurredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt) ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > 1440 ||
    (distance !== undefined &&
      distance !== null &&
      (typeof distance !== 'number' ||
        !Number.isFinite(distance) ||
        distance < 0 ||
        distance > 2000))
  )
    return null;
  const calendarDate = occurredAt.slice(0, 10);
  if (isoDate(new Date(`${calendarDate}T00:00:00Z`)) !== calendarDate) return null;
  return {
    sport: sport as Sport,
    occurredAt: new Date(occurredAt).toISOString(),
    duration,
    distance: typeof distance === 'number' ? distance : null,
  };
}

function aggregate(activities: Projection[], period: InsightsPeriod): ActivityTotals {
  const totals: ActivityTotals = {
    sessions: 0,
    minutes: 0,
    distanceKm: 0,
    activeDays: 0,
    bySport: [],
  };
  const days = new Set<string>();
  const end = endExclusive(period);
  for (const activity of activities) {
    if (activity.occurredAt < `${period.start}T00:00:00.000Z` || activity.occurredAt >= end)
      continue;
    totals.sessions++;
    totals.minutes += activity.duration;
    totals.distanceKm += activity.distance ?? 0;
    days.add(activity.occurredAt.slice(0, 10));
    let sport = totals.bySport.find((entry) => entry.sport === activity.sport);
    if (!sport) {
      sport = { sport: activity.sport, sessions: 0, minutes: 0, distanceKm: 0 };
      totals.bySport.push(sport);
    }
    sport.sessions++;
    sport.minutes += activity.duration;
    sport.distanceKm += activity.distance ?? 0;
  }
  totals.activeDays = days.size;
  totals.bySport.sort((a, b) => SPORTS.indexOf(a.sport) - SPORTS.indexOf(b.sport));
  // Avoid exposing binary floating-point noise in factual summaries.
  totals.distanceKm = Math.round(totals.distanceKm * 1e6) / 1e6;
  totals.minutes = Math.round(totals.minutes * 1e6) / 1e6;
  for (const sport of totals.bySport) {
    sport.distanceKm = Math.round(sport.distanceKm * 1e6) / 1e6;
    sport.minutes = Math.round(sport.minutes * 1e6) / 1e6;
  }
  return totals;
}

/** Load the owner's validated activities; GitHub rows are limited to [start, end). */
async function loadActivities(
  db: D1Database,
  identity: InsightsIdentity,
  start: string,
  end: string,
): Promise<{ activities: Projection[]; excluded: number }> {
  const activities: Projection[] = [];
  let excluded = 0;
  if (identity.provider === 'github') {
    const rows = await db
      .prepare(
        `SELECT sport, occurred_at AS occurredAt, duration, distance FROM activities
         WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?`,
      )
      .bind(identity.user.id, start, end)
      .all();
    for (const row of rows.results) {
      const activity = projection(row);
      if (activity) activities.push(activity);
      else excluded++;
    }
  } else {
    // Parse outside SQLite so malformed indexed JSON cannot abort the recap.
    const rows = await db
      .prepare('SELECT record_json FROM atproto_activities WHERE did = ?')
      .bind(identity.user.id)
      .all<{ record_json: string }>();
    for (const row of rows.results) {
      try {
        const activity = projection(JSON.parse(row.record_json));
        if (activity) activities.push(activity);
        else excluded++;
      } catch {
        excluded++;
      }
    }
  }
  return { activities, excluded };
}

const activityCoverage = (identity: InsightsIdentity, excluded: number) =>
  (identity.provider === 'github'
    ? 'Own recorded activities in D1, including private activities; no feed limit. Not a complete record of all exercise.'
    : 'Own validated AT Protocol activity projections currently indexed in D1 only; not a live or complete PDS history. No feed limit.') +
  ` Missing distances contribute no distance; totals include known distance only.${excluded ? ` Excluded ${excluded} malformed activity record(s).` : ''}`;

export async function getWeeklyRecap(
  db: D1Database,
  identity: InsightsIdentity,
  options: InsightsOptions = {},
): Promise<WeeklyRecap> {
  const { period, previousPeriod } = insightsPeriods(options.now);
  const { activities, excluded } = await loadActivities(
    db,
    identity,
    `${previousPeriod.start}T00:00:00.000Z`,
    endExclusive(period),
  );
  const current = aggregate(activities, period);
  const previous = aggregate(activities, previousPeriod);
  const coverage = activityCoverage(identity, excluded);
  return {
    period,
    previousPeriod,
    current,
    previous,
    summary: `${period.start}–${period.end} (UTC): ${count(current.sessions, 'session')}, ${count(current.minutes, 'minute')}, ${current.distanceKm} km of known distance, ${count(current.activeDays, 'active day')}. Previous week ${previousPeriod.start}–${previousPeriod.end}: ${count(previous.sessions, 'session')}, ${count(previous.minutes, 'minute')}, ${previous.distanceKm} km of known distance, ${count(previous.activeDays, 'active day')}.`,
    coverage,
  };
}

async function githubJson(url: string, source: string, fetcher: typeof fetch): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      headers: GITHUB_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new HttpError(
        502,
        `GitHub ${source} API failed (HTTP ${response.status}); rate limits may apply.`,
      );
    return await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `GitHub ${source} API could not be reached or returned invalid JSON.`);
  }
}

export async function getCodeMovementChallenge(
  db: D1Database,
  identity: InsightsIdentity,
  options: InsightsOptions = {},
): Promise<CodeMovementChallenge> {
  if (identity.provider !== 'github')
    throw new HttpError(400, 'This challenge requires a GitHub account.');
  const now = options.now ?? new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const period = {
    start: isoDate(new Date(today - 29 * DAY)),
    end: isoDate(new Date(today)),
  };
  const rows = await db
    .prepare(
      `SELECT sport, occurred_at AS occurredAt, duration, distance FROM activities
       WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?`,
    )
    .bind(identity.user.id, `${period.start}T00:00:00.000Z`, endExclusive(period))
    .all();
  const moved = new Set<string>();
  for (const row of rows.results) {
    const activity = projection(row);
    if (activity && Date.parse(activity.occurredAt) <= now.getTime())
      moved.add(activity.occurredAt.slice(0, 10));
  }

  const commits = new Set<string>();
  let truncated = false;
  const search = new URL('https://api.github.com/search/commits');
  search.searchParams.set(
    'q',
    `author:${identity.user.username} author-date:${period.start}T00:00:00Z..${period.end}T23:59:59Z is:public`,
  );
  search.searchParams.set('per_page', '100');
  for (let page = 1; page <= 3; page++) {
    search.searchParams.set('page', String(page));
    const result = await githubJson(
      search.toString(),
      'public commit search',
      options.fetch ?? fetch,
    );
    if (
      !isRecord(result) ||
      typeof result['total_count'] !== 'number' ||
      !Number.isSafeInteger(result['total_count']) ||
      result['total_count'] < 0 ||
      typeof result['incomplete_results'] !== 'boolean' ||
      !Array.isArray(result['items']) ||
      result['items'].length > 100
    )
      throw new HttpError(502, 'GitHub public commit search API returned invalid search data.');
    truncated ||= result['incomplete_results'];
    for (const item of result['items']) {
      if (
        !isRecord(item) ||
        !isRecord(item['commit']) ||
        !isRecord(item['commit']['author']) ||
        typeof item['commit']['author']['date'] !== 'string'
      )
        throw new HttpError(502, 'GitHub public commit search API returned invalid commit data.');
      const timestamp = Date.parse(item['commit']['author']['date']);
      if (!Number.isFinite(timestamp))
        throw new HttpError(502, 'GitHub public commit search API returned invalid commit data.');
      if (timestamp >= today - 29 * DAY && timestamp <= now.getTime())
        commits.add(isoDate(new Date(timestamp)));
    }
    if (result['items'].length < 100) {
      if ((page - 1) * 100 + result['items'].length < result['total_count']) truncated = true;
      break;
    }
    if (page * 100 >= result['total_count']) break;
    if (page === 3) truncated = true;
  }
  return {
    period,
    days: Array.from({ length: 30 }, (_, index) => {
      const date = isoDate(new Date(today - (29 - index) * DAY));
      return { date, moved: moved.has(date), commitFound: commits.has(date) };
    }),
    truncated,
  };
}

export async function getGithubInsights(
  _db: D1Database,
  identity: InsightsIdentity,
  options: InsightsOptions = {},
): Promise<GithubInsights> {
  if (identity.provider !== 'github')
    throw new HttpError(400, 'GitHub insights require a GitHub account.');
  const { period } = insightsPeriods(options.now);
  const start = Date.parse(`${period.start}T00:00:00Z`);
  const end = Date.parse(endExclusive(period));
  const seen = new Set<string>();
  let pushEvents = 0;
  let boundaryCovered = false;
  const fetcher = options.fetch ?? fetch;
  for (let page = 1; page <= 3; page++) {
    const events = await githubJson(
      `https://api.github.com/users/${encodeURIComponent(identity.user.username)}/events/public?per_page=100&page=${page}`,
      'public events',
      fetcher,
    );
    if (!Array.isArray(events) || events.length > 100)
      throw new HttpError(502, 'GitHub public events API returned invalid event data.');
    for (const event of events) {
      if (
        !isRecord(event) ||
        typeof event['id'] !== 'string' ||
        typeof event['type'] !== 'string' ||
        typeof event['created_at'] !== 'string' ||
        !Number.isFinite(Date.parse(event['created_at']))
      )
        throw new HttpError(502, 'GitHub public events API returned invalid event data.');
      const timestamp = Date.parse(event['created_at']);
      if (timestamp < start) boundaryCovered = true;
      if (seen.has(event['id'])) continue;
      seen.add(event['id']);
      if (timestamp < start || timestamp >= end || event['type'] !== 'PushEvent') continue;
      pushEvents++;
    }
    if (boundaryCovered || events.length < 100) {
      boundaryCovered = true;
      break;
    }
  }
  const search = new URL('https://api.github.com/search/commits');
  search.searchParams.set(
    'q',
    `author:${identity.user.username} author-date:${period.start}T00:00:00Z..${period.end}T23:59:59Z is:public`,
  );
  search.searchParams.set('per_page', '1');
  const commitSearch = await githubJson(search.toString(), 'public commit search', fetcher);
  if (
    !isRecord(commitSearch) ||
    typeof commitSearch['total_count'] !== 'number' ||
    !Number.isSafeInteger(commitSearch['total_count']) ||
    commitSearch['total_count'] < 0 ||
    typeof commitSearch['incomplete_results'] !== 'boolean'
  )
    throw new HttpError(502, 'GitHub public commit search API returned invalid search data.');

  return {
    period,
    pushEvents,
    commits: commitSearch['total_count'],
    username: identity.user.username,
    complete: false,
    coverage: `Public pushes exclude private repositories and are limited to 300 events / 90 days.${boundaryCovered ? ' Available history boundary reached.' : ' 300-event cap reached before the week boundary; weekly push totals may be partial.'} Public commits are GitHub search results for commits authored during the week on default branches of public repositories; search indexing may be incomplete.${commitSearch['incomplete_results'] ? ' GitHub reported incomplete search results, so the commit count may be partial.' : ''} No OAuth token or expanded permissions used.`,
  };
}

function longestStreak(activities: Projection[]): number {
  const days = [...new Set(activities.map((activity) => activity.occurredAt.slice(0, 10)))]
    .map((day) => Date.parse(`${day}T00:00:00Z`))
    .sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  for (let index = 0; index < days.length; index++) {
    current = index > 0 && days[index] - days[index - 1] === DAY ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** Monthly digest for a completed UTC month, or the yearly Wrapped during its seasonal window. */
export async function getPeriodRecap(
  db: D1Database,
  identity: InsightsIdentity,
  kind: string | null,
  month: string | null,
  options: InsightsOptions = {},
): Promise<PeriodRecap> {
  const now = options.now ?? new Date();
  let period: InsightsPeriod;
  let partial = false;
  if (kind === 'wrapped') {
    const wrapped = wrappedPeriod(now);
    if (!wrapped)
      throw new HttpError(404, 'Wrapped is available from December 25 through January 31 (UTC).');
    ({ period, partial } = wrapped);
  } else if (kind === 'monthly') {
    const selected = monthlyPeriod(month ?? completedMonths(now, 1)[0], now);
    if (!selected) throw new HttpError(400, 'Choose a completed UTC calendar month (YYYY-MM).');
    period = selected;
  } else {
    throw new HttpError(400, 'Recap type must be monthly or wrapped.');
  }

  const loaded = await loadActivities(
    db,
    identity,
    `${period.start}T00:00:00.000Z`,
    endExclusive(period),
  );
  const start = `${period.start}T00:00:00.000Z`;
  const end = endExclusive(period);
  const activities = loaded.activities.filter(
    (activity) =>
      activity.occurredAt >= start &&
      activity.occurredAt < end &&
      Date.parse(activity.occurredAt) <= now.getTime(),
  );

  let commits: number | null = null;
  let commitCoverage = 'GitHub commit counts need a GitHub account.';
  if (identity.provider === 'github') {
    const search = new URL('https://api.github.com/search/commits');
    const periodEnd = `${period.end}T23:59:59Z`;
    const commitEnd =
      now.getTime() < Date.parse(periodEnd) ? `${now.toISOString().slice(0, 19)}Z` : periodEnd;
    search.searchParams.set(
      'q',
      `author:${identity.user.username} author-date:${period.start}T00:00:00Z..${commitEnd} is:public`,
    );
    search.searchParams.set('per_page', '1');
    try {
      const result = await githubJson(
        search.toString(),
        'public commit search',
        options.fetch ?? fetch,
      );
      if (
        !isRecord(result) ||
        typeof result['total_count'] !== 'number' ||
        !Number.isSafeInteger(result['total_count']) ||
        result['total_count'] < 0 ||
        typeof result['incomplete_results'] !== 'boolean'
      )
        throw new HttpError(502, 'GitHub public commit search API returned invalid search data.');
      commits = result['total_count'];
      commitCoverage = `Public commits authored on default branches of public repositories, from GitHub search; private repositories are excluded and indexing may be incomplete.${result['incomplete_results'] ? ' GitHub reported incomplete results, so this count may be partial.' : ''} No extra OAuth permissions are used.`;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      commitCoverage = `Public commit count unavailable. ${error.message}`;
    }
  }

  return {
    kind,
    period,
    partial,
    totals: aggregate(activities, period),
    longestStreak: longestStreak(activities),
    commits,
    coverage: activityCoverage(identity, loaded.excluded),
    commitCoverage,
  };
}
