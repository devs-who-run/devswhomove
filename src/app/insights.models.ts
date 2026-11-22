import type { Sport } from './models';

/** Inclusive UTC calendar dates, Monday through Sunday. */
export interface InsightsPeriod {
  start: string;
  end: string;
}

export interface SportTotals {
  sport: Sport;
  sessions: number;
  minutes: number;
  distanceKm: number;
}

export interface ActivityTotals {
  sessions: number;
  minutes: number;
  distanceKm: number;
  activeDays: number;
  bySport: SportTotals[];
}

export interface WeeklyRecap {
  period: InsightsPeriod;
  previousPeriod: InsightsPeriod;
  current: ActivityTotals;
  previous: ActivityTotals;
  summary: string;
  coverage: string;
}

export interface GithubInsights {
  period: InsightsPeriod;
  pushEvents: number;
  commits: number | null;
  coverage: string;
  complete: boolean;
  username: string;
}

export interface PeriodRecap {
  kind: 'monthly' | 'wrapped';
  /** Inclusive UTC dates. A December Wrapped ends today (year to date). */
  period: InsightsPeriod;
  partial: boolean;
  totals: ActivityTotals;
  longestStreak: number;
  /** Public default-branch commits from GitHub search; null if unavailable. */
  commits: number | null;
  coverage: string;
  commitCoverage: string;
}

export interface CodeMovementChallenge {
  period: InsightsPeriod;
  days: { date: string; moved: boolean; commitFound: boolean }[];
  truncated: boolean;
}
