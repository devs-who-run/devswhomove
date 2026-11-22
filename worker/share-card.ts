import type { Activity } from '../src/app/models';
import type { PeriodRecap } from '../src/app/insights.models';
import { SHARE_CARD_DESIGN_VERSION } from '../src/app/share-card-version';
import { SPORT_ICON_PATHS } from '../src/app/sport-icons';
import brandIcon from '../public/brand/icon.svg?raw';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const brandIconUri = `data:image/svg+xml,${encodeURIComponent(brandIcon)}`;

/** Fields rendered on a public share card. Notes and photos are deliberately left out. */
export type CardActivity = Pick<
  Activity,
  'id' | 'name' | 'username' | 'title' | 'sport' | 'occurredAt' | 'duration' | 'distance'
>;

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

/** Remove control characters that are invalid in XML/HTML and collapse whitespace. */
const clean = (value: string | null | undefined) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\ufffe\uffff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const shorten = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/** Wrap text into at most `lines` lines of roughly `perLine` characters, ellipsizing overflow. */
export function wrapText(value: string, perLine: number, lines: number): string[] {
  const words = clean(value).split(' ').filter(Boolean);
  const result: string[] = [];
  let current = '';
  for (let index = 0; index < words.length; index++) {
    const word = shorten(words[index], perLine);
    const next = current ? `${current} ${word}` : word;
    if (next.length <= perLine) {
      current = next;
      continue;
    }
    if (result.length === lines - 1) {
      result.push(shorten(`${current} ${word}`, perLine).replace(/…?$/, '…'));
      return result;
    }
    result.push(current);
    current = word;
  }
  if (current) result.push(current);
  return result;
}

const format = (value: number, digits: number) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits });

/** Format minutes as "45 min" or "1h 05m". */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${format(minutes, 1)} min`;
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

/** Return up to three headline metrics for an activity. */
export function cardMetrics(
  activity: CardActivity,
): { label: string; value: string; unit: string }[] {
  const metrics: { label: string; value: string; unit: string }[] = [];
  const { distance, duration, sport } = activity;
  if (distance !== null && distance > 0)
    metrics.push({ label: 'DISTANCE', value: format(distance, 2), unit: 'km' });
  const time = formatDuration(duration);
  const [timeValue, timeUnit] = time.endsWith(' min') ? [time.slice(0, -4), 'min'] : [time, ''];
  metrics.push({ label: 'MOVING TIME', value: timeValue, unit: timeUnit });
  if (sport === 'Running' && distance && duration > 0) {
    const seconds = Math.round((duration * 60) / distance);
    metrics.push({
      label: 'AVG. PACE',
      value: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
      unit: '/km',
    });
  } else if (sport === 'Cycling' && distance && duration > 0) {
    metrics.push({
      label: 'AVG. SPEED',
      value: format((distance / duration) * 60, 1),
      unit: 'km/h',
    });
  }
  return metrics;
}

const cardDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
};

/** Build the 1200×630 share card as SVG, using only fonts bundled with the Worker. */
export function cardSvg(activity: CardActivity, host: string): string {
  const title = wrapText(activity.title, 24, 2);
  const metrics = cardMetrics(activity);
  const sport = SPORT_ICON_PATHS[activity.sport] ? activity.sport : 'Other';
  const titleTop = title.length > 1 ? 222 : 262;
  const byline = shorten(clean(activity.name), 32);
  const handle = shorten(clean(activity.username), 40);
  const metricWidth = 300;
  const pillWidth = sport.length * 15 + 84;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.05"/>
    </pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b3f31"/>
      <stop offset="1" stop-color="#234d3c"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#fade)"/>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#grid)"/>
  <g fill="none" stroke="#bce0c7" stroke-opacity="0.12" stroke-width="2">
    <path d="M760 -40c-80 80 110 75 40 170S900 230 830 380s120 200 40 320"/>
    <path d="M830 -40c-80 80 110 75 40 170S970 230 900 380s120 200 40 320"/>
    <path d="M900 -40c-80 80 110 75 40 170S1040 230 970 380s120 200 40 320"/>
    <path d="M970 -40c-80 80 110 75 40 170S1110 230 1040 380s120 200 40 320"/>
    <path d="M1040 -40c-80 80 110 75 40 170S1180 230 1110 380s120 200 40 320"/>
  </g>
  <g transform="translate(870 150) scale(14)" fill="none" stroke="#d8f294" stroke-opacity="0.16" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="${SPORT_ICON_PATHS[sport]}"/>
  </g>
  <g transform="translate(72 64)">
    <image width="52" height="52" href="${brandIconUri}"/>
    <text x="70" y="36" font-family="Manrope" font-weight="800" font-size="28" fill="#ffffff">Devs Who Move</text>
  </g>
  <g transform="translate(${CARD_WIDTH - 72} 64)">
    <rect x="${-pillWidth}" width="${pillWidth}" height="52" rx="26" fill="#d8f294" fill-opacity="0.14" stroke="#d8f294" stroke-opacity="0.5"/>
    <g transform="translate(${-pillWidth + 20} 14)" fill="none" stroke="#d8f294" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="${SPORT_ICON_PATHS[sport]}"/>
    </g>
    <text x="-24" y="35" text-anchor="end" font-family="DM Sans" font-weight="600" font-size="22" letter-spacing="2" fill="#d8f294">${escapeXml(sport.toUpperCase())}</text>
  </g>
  ${title
    .map(
      (line, index) =>
        `<text x="72" y="${titleTop + index * 76}" font-family="Manrope" font-weight="800" font-size="68" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join('\n  ')}
  ${metrics
    .map(
      (metric, index) => `<g transform="translate(${72 + index * metricWidth} 392)">
    <text font-family="DM Sans" font-weight="600" font-size="20" letter-spacing="2" fill="#bdd99b">${metric.label}</text>
    <text y="66" font-family="Manrope" font-weight="800" font-size="60" fill="#ffffff">${escapeXml(metric.value)}${metric.unit ? `<tspan dx="8" font-family="DM Sans" font-weight="400" font-size="28" fill="#cde6ad">${escapeXml(metric.unit)}</tspan>` : ''}</text>
  </g>`,
    )
    .join('\n  ')}
  <line x1="72" y1="516" x2="${CARD_WIDTH - 72}" y2="516" stroke="#ffffff" stroke-opacity="0.14"/>
  <text x="72" y="568" font-family="DM Sans" font-weight="600" font-size="28" fill="#ffffff">${escapeXml(byline)}<tspan dx="12" font-weight="400" fill="#bdd99b">@${escapeXml(handle)}${cardDate(activity.occurredAt) ? ` · ${escapeXml(cardDate(activity.occurredAt))}` : ''}</tspan></text>
  <text x="${CARD_WIDTH - 72}" y="568" text-anchor="end" font-family="DM Sans" font-weight="600" font-size="26" fill="#d8f294">${escapeXml(host)}</text>
</svg>`;
}

/** Content hash used to version card URLs and cache entries when activity or design changes. */
export async function cardVersion(activity: CardActivity): Promise<string> {
  const fields = [
    activity.id,
    activity.name,
    activity.username,
    activity.title,
    activity.sport,
    activity.occurredAt,
    activity.duration,
    activity.distance,
    brandIcon,
  ];
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`v${SHARE_CARD_DESIGN_VERSION}:${JSON.stringify(fields)}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 6), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

const escapeHtml = escapeXml;

type MetaTag = [attribute: 'property' | 'name', key: string, value: string];

const renderMetaTags = (tags: MetaTag[]) =>
  tags.map(
    ([attribute, key, value]) => `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`,
  );

/** OpenGraph and Twitter meta tags for the website and profile pages. */
export function websiteShareTags(origin: string, path: string): string {
  const image = `${origin}/og-image.png`;
  const alt = 'Devs Who Move logo with the words Your people. Your pace.';
  const title = 'Devs Who Move - Your people. Your pace.';
  const description =
    'A community for developers and their agents to share movement, find events, and connect.';
  return renderMetaTags([
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Devs Who Move'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', `${origin}${path}`],
    ['property', 'og:image', image],
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', alt],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', image],
    ['name', 'twitter:image:alt', alt],
  ]).join('\n    ');
}

/** OpenGraph and Twitter meta tags for a public activity page. */
export function shareMeta(
  activity: CardActivity,
  origin: string,
  version: string,
): { title: string; description: string; tags: string } {
  const id = encodeURIComponent(activity.id);
  const pageUrl = `${origin}/activities/${id}`;
  const imageUrl = `${origin}/api/activities/${id}/card.png?v=${version}`;
  const name = clean(activity.name);
  const sport = activity.sport.toLowerCase();
  const title = `${clean(activity.title)} · ${name} on Devs Who Move`;
  const effort =
    activity.distance !== null && activity.distance > 0
      ? `${format(activity.distance, 2)} km of ${sport}`
      : `${formatDuration(activity.duration)} of ${sport}`;
  const description = `${name} logged ${effort}${
    activity.distance !== null && activity.distance > 0
      ? ` in ${formatDuration(activity.duration)}`
      : ''
  }. A sports community for developers who move.`;
  const alt = `${activity.sport} activity card: ${cardMetrics(activity)
    .map(
      (metric) =>
        `${metric.label.toLowerCase()} ${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`,
    )
    .join(', ')}.`;
  const meta: MetaTag[] = [
    ['property', 'og:type', 'article'],
    ['property', 'og:site_name', 'Devs Who Move'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', pageUrl],
    ['property', 'og:image', imageUrl],
    ['property', 'og:image:secure_url', imageUrl],
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', String(CARD_WIDTH)],
    ['property', 'og:image:height', String(CARD_HEIGHT)],
    ['property', 'og:image:alt', alt],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', imageUrl],
    ['name', 'twitter:image:alt', alt],
  ];
  const tags = [
    `<link rel="canonical" href="${escapeHtml(pageUrl)}" />`,
    ...renderMetaTags(meta),
  ].join('\n    ');
  return { title, description, tags };
}

/** Headline metrics for a monthly digest or Wrapped card, in display order. */
export function recapMetrics(recap: PeriodRecap): { label: string; value: string; unit: string }[] {
  const metrics: { label: string; value: string; unit: string }[] = [];
  if (recap.commits !== null)
    metrics.push({ label: 'PUBLIC COMMITS', value: format(recap.commits, 0), unit: '' });
  metrics.push({ label: 'DISTANCE', value: format(recap.totals.distanceKm, 1), unit: 'km' });
  metrics.push({ label: 'SESSIONS', value: format(recap.totals.sessions, 0), unit: '' });
  metrics.push(
    recap.kind === 'wrapped'
      ? {
          label: 'LONGEST STREAK',
          value: format(recap.longestStreak, 0),
          unit: recap.longestStreak === 1 ? 'day' : 'days',
        }
      : { label: 'ACTIVE DAYS', value: format(recap.totals.activeDays, 0), unit: '' },
  );
  return metrics;
}

export function recapTitle(recap: PeriodRecap): string {
  const start = new Date(`${recap.period.start}T00:00:00Z`);
  if (recap.kind === 'wrapped')
    return `${start.getUTCFullYear()} Wrapped${recap.partial ? ' (so far)' : ''}`;
  return `${start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} digest`;
}

/** Build a 1200×630 recap card. Only totals are shown; no titles, notes, places or photos. */
export function recapCardSvg(
  recap: PeriodRecap,
  person: { name: string; username: string },
  host: string,
): string {
  const metrics = recapMetrics(recap);
  const metricWidth = (CARD_WIDTH - 144) / metrics.length;
  const topSport = [...recap.totals.bySport].sort((a, b) => b.sessions - a.sessions)[0]?.sport;
  const subtitle = `${cardDate(`${recap.period.start}T00:00:00Z`)} – ${cardDate(`${recap.period.end}T00:00:00Z`)}${topSport ? ` · Top sport: ${topSport}` : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.05"/>
    </pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b3f31"/>
      <stop offset="1" stop-color="#234d3c"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#fade)"/>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#grid)"/>
  <g transform="translate(72 64)">
    <image width="52" height="52" href="${brandIconUri}"/>
    <text x="70" y="36" font-family="Manrope" font-weight="800" font-size="28" fill="#ffffff">Devs Who Move</text>
  </g>
  <text x="72" y="250" font-family="Manrope" font-weight="800" font-size="72" fill="#ffffff">${escapeXml(recapTitle(recap))}</text>
  <text x="72" y="300" font-family="DM Sans" font-weight="400" font-size="26" fill="#bdd99b">${escapeXml(subtitle)}</text>
  ${metrics
    .map(
      (metric, index) => `<g transform="translate(${72 + index * metricWidth} 392)">
    <text font-family="DM Sans" font-weight="600" font-size="20" letter-spacing="2" fill="#bdd99b">${metric.label}</text>
    <text y="66" font-family="Manrope" font-weight="800" font-size="56" fill="#ffffff">${escapeXml(metric.value)}${metric.unit ? `<tspan dx="8" font-family="DM Sans" font-weight="400" font-size="26" fill="#cde6ad">${escapeXml(metric.unit)}</tspan>` : ''}</text>
  </g>`,
    )
    .join('\n  ')}
  <line x1="72" y1="516" x2="${CARD_WIDTH - 72}" y2="516" stroke="#ffffff" stroke-opacity="0.14"/>
  <text x="72" y="568" font-family="DM Sans" font-weight="600" font-size="28" fill="#ffffff">${escapeXml(shorten(clean(person.name), 32))}<tspan dx="12" font-weight="400" fill="#bdd99b">@${escapeXml(shorten(clean(person.username), 40))}</tspan></text>
  <text x="${CARD_WIDTH - 72}" y="568" text-anchor="end" font-family="DM Sans" font-weight="600" font-size="26" fill="#d8f294">${escapeXml(host)}</text>
</svg>`;
}
