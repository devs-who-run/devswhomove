import { HttpError } from './validation';

interface RatePolicy {
  name: string;
  windowSeconds: number;
  accountLimit?: number;
  ipLimit: number;
}

const HOUR = 60 * 60;
const TEN_MINUTES = 10 * 60;

const POLICIES: Record<string, RatePolicy> = {
  auth: { name: 'auth', windowSeconds: TEN_MINUTES, ipLimit: 10 },
  mcp: { name: 'mcp', windowSeconds: HOUR, ipLimit: 1_200 },
  read: { name: 'read', windowSeconds: HOUR, accountLimit: 600, ipLimit: 1_200 },
  bulk: { name: 'bulk', windowSeconds: HOUR, accountLimit: 10, ipLimit: 30 },
  photo: { name: 'photo', windowSeconds: HOUR, accountLimit: 10, ipLimit: 30 },
  comment: { name: 'comment', windowSeconds: HOUR, accountLimit: 30, ipLimit: 120 },
  social: { name: 'social', windowSeconds: HOUR, accountLimit: 120, ipLimit: 300 },
  activity: { name: 'activity', windowSeconds: HOUR, accountLimit: 60, ipLimit: 120 },
  event: { name: 'event', windowSeconds: HOUR, accountLimit: 30, ipLimit: 90 },
  write: { name: 'write', windowSeconds: HOUR, accountLimit: 120, ipLimit: 300 },
};

/** Select a policy for externally initiated authentication or API mutations. */
function policyFor(request: Request): RatePolicy | undefined {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();

  if (
    method === 'GET' &&
    (pathname.startsWith('/auth/github') || pathname.startsWith('/auth/atproto'))
  )
    return POLICIES['auth'];
  if (pathname === '/mcp' && method === 'POST') return POLICIES['mcp'];
  if (!pathname.startsWith('/api/') || method === 'OPTIONS') return;
  if (['GET', 'HEAD'].includes(method)) return POLICIES['read'];

  if (pathname === '/api/activities/bulk') return POLICIES['bulk'];
  if (/^\/api\/activities\/[^/]+\/photo$/.test(pathname)) return POLICIES['photo'];
  if (/^\/api\/activities\/[^/]+\/comments$/.test(pathname) && method === 'POST')
    return POLICIES['comment'];
  if (
    /^\/api\/(follows|clubs|activities\/[^/]+\/(kudos|comments))/.test(pathname) ||
    /^\/api\/clubs\/[^/]+\/membership$/.test(pathname)
  )
    return POLICIES['social'];
  if (
    /^\/api\/activities(?:\/[^/]+)?$/.test(pathname) ||
    pathname === '/api/me' ||
    pathname.includes('visibility')
  )
    return POLICIES['activity'];
  if (/^\/api\/events(?:\/|$)/.test(pathname)) return POLICIES['event'];
  return POLICIES['write'];
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function consume(
  db: D1Database,
  bucket: string,
  limit: number,
  windowSeconds: number,
  nowSeconds: number,
): Promise<void> {
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const bucketHash = await hash(bucket);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(bucket) DO UPDATE SET
        request_count = CASE WHEN rate_limits.window_start = excluded.window_start
          THEN rate_limits.request_count + 1 ELSE 1 END,
        window_start = excluded.window_start
      RETURNING request_count AS requestCount`,
    )
    .bind(bucketHash, windowStart)
    .first<{ requestCount: number }>();

  if (!row || row.requestCount <= limit) return;
  const retryAfter = Math.max(1, windowStart + windowSeconds - nowSeconds);
  throw new HttpError(429, 'Too many requests. Please wait before trying again.', {
    'Retry-After': String(retryAfter),
  });
}

/** Enforce a fixed-window policy using hashed account and Cloudflare client-IP buckets. */
export async function enforceRateLimit(
  request: Request,
  db: D1Database,
  options: { accountId?: string; includeIp?: boolean } = {},
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  const policy = policyFor(request);
  if (!policy) return;

  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp && options.includeIp !== false)
    await consume(
      db,
      `${policy.name}:ip:${clientIp}`,
      policy.ipLimit,
      policy.windowSeconds,
      nowSeconds,
    );
  if (options.accountId && policy.accountLimit)
    await consume(
      db,
      `${policy.name}:account:${options.accountId}`,
      policy.accountLimit,
      policy.windowSeconds,
      nowSeconds,
    );
}
