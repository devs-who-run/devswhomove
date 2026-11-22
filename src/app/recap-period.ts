import type { InsightsPeriod } from './insights.models';

const DAY = 86_400_000;
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * Wrapped runs from December 25 through January 31 (UTC). In December it covers the year to
 * date; in January it covers the completed previous year.
 */
export function wrappedPeriod(
  now = new Date(),
): { year: number; period: InsightsPeriod; partial: boolean } | null {
  const year = now.getUTCFullYear();
  if (now.getUTCMonth() === 11 && now.getUTCDate() >= 25)
    return { year, period: { start: `${year}-01-01`, end: isoDate(now.getTime()) }, partial: true };
  if (now.getUTCMonth() === 0)
    return {
      year: year - 1,
      period: { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` },
      partial: false,
    };
  return null;
}

/** The most recent completed UTC calendar months, newest first, as `YYYY-MM`. */
export function completedMonths(now = new Date(), count = 12): string[] {
  return Array.from({ length: count }, (_, index) =>
    isoDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - index, 1)).slice(0, 7),
  );
}

/** Inclusive period for a completed UTC month, or null if the month is invalid or not finished. */
export function monthlyPeriod(month: string, now = new Date()): InsightsPeriod | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || Number(match[1]) < 2000) return null;
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
  const next = Date.UTC(Number(match[1]), Number(match[2]), 1);
  if (next > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) return null;
  return { start: isoDate(start), end: isoDate(next - DAY) };
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
