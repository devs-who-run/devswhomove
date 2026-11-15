import { describe, expect, it } from 'vitest';
import { computeBadges } from './badges';
import type { Activity, Sport } from './models';

let nextId = 0;
const activity = (
  occurredAt: string,
  overrides: Partial<Pick<Activity, 'sport' | 'distance' | 'source'>> = {},
): Activity => ({
  id: String(++nextId),
  userId: 'u1',
  username: 'runner',
  name: 'Runner',
  avatar: '',
  title: 'Move',
  sport: 'Walking' as Sport,
  occurredAt: new Date(occurredAt).toISOString(),
  duration: 30,
  distance: null,
  notes: '',
  visibility: 'public',
  source: 'web',
  ...overrides,
});
const earned = (activities: Activity[]) =>
  computeBadges(activities)
    .filter((badge) => badge.earned)
    .map((badge) => badge.id);

describe('computeBadges', () => {
  it('earns nothing without activities', () => {
    expect(earned([])).toEqual([]);
  });

  it('awards distance badges from the longest single run only', () => {
    const badges = earned([
      activity('2026-11-02T12:00', { sport: 'Running', distance: 21.1 }),
      activity('2026-11-04T12:00', { sport: 'Walking', distance: 50 }),
    ]);
    expect(badges).toEqual(expect.arrayContaining(['first-move', 'run-5k', 'run-10k', 'run-half']));
    expect(badges).not.toContain('run-marathon');
  });

  it('sums cycling distance and reports capped progress', () => {
    const rides = [60, 30].map((distance, index) =>
      activity(`2026-11-0${index + 2}T12:00`, { sport: 'Cycling', distance }),
    );
    expect(computeBadges(rides).find((badge) => badge.id === 'cycling-100')).toMatchObject({
      earned: false,
      progress: 90,
    });
    rides.push(activity('2026-11-05T12:00', { sport: 'Cycling', distance: 20 }));
    expect(computeBadges(rides).find((badge) => badge.id === 'cycling-100')).toMatchObject({
      earned: true,
      progress: 100,
    });
  });

  it('counts consecutive local days, ignoring same-day duplicates and gaps', () => {
    const badges = earned([
      activity('2026-11-01T12:00'),
      activity('2026-11-02T08:00'),
      activity('2026-11-02T18:00'),
      activity('2026-11-03T12:00'),
      activity('2026-11-05T12:00'),
    ]);
    expect(badges).toContain('streak-3');
    expect(badges).not.toContain('streak-7');
  });

  it('counts consecutive Monday-start weeks', () => {
    const weekly = ['2026-11-01', '2026-11-02', '2026-11-09', '2026-11-16'].map((day) =>
      activity(`${day}T12:00`),
    );
    expect(earned(weekly)).toContain('weeks-4');
    expect(earned(weekly.slice(1))).not.toContain('weeks-4');
  });

  it('awards variety, agent, and time-of-day badges', () => {
    const badges = earned([
      activity('2026-11-02T06:30', { sport: 'Running' }),
      activity('2026-11-03T21:15', { sport: 'Swimming', source: 'agent' }),
      activity('2026-11-04T12:00', { sport: 'Tennis' }),
    ]);
    expect(badges).toEqual(
      expect.arrayContaining(['variety-3', 'agent', 'early-bird', 'night-owl']),
    );
  });
});
