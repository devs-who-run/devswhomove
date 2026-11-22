import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeriodRecap } from './insights.models';
import type { Profile } from './models';
import { PeriodRecaps, recapSummary } from './period-recaps';
import { completedMonths, monthlyPeriod, wrappedPeriod } from './recap-period';

const profile: Profile = {
  id: 'alice',
  username: 'alice',
  name: 'Alice',
  avatar: '',
  bio: '',
  location: '',
  sports: [],
  visibility: 'private',
  provider: 'github',
};
const recap = (kind: PeriodRecap['kind']): PeriodRecap => ({
  kind,
  period: { start: '2026-01-01', end: '2026-12-31' },
  partial: false,
  totals: { sessions: 140, minutes: 9000, distanceKm: 800, activeDays: 120, bySport: [] },
  longestStreak: 12,
  commits: 1200,
  coverage: 'Own recorded activities.',
  commitCoverage: 'Public commits only.',
});

describe('recap periods', () => {
  it('opens Wrapped only from December 25 through January 31 (UTC)', () => {
    expect(wrappedPeriod(new Date('2026-12-24T23:59:59Z'))).toBeNull();
    expect(wrappedPeriod(new Date('2026-12-25T00:00:00Z'))).toEqual({
      year: 2026,
      period: { start: '2026-01-01', end: '2026-12-25' },
      partial: true,
    });
    expect(wrappedPeriod(new Date('2027-01-31T23:59:59Z'))).toEqual({
      year: 2026,
      period: { start: '2026-01-01', end: '2026-12-31' },
      partial: false,
    });
    expect(wrappedPeriod(new Date('2027-02-01T00:00:00Z'))).toBeNull();
  });

  it('lists only completed months, across year boundaries', () => {
    const now = new Date('2027-01-10T00:00:00Z');
    expect(completedMonths(now, 2)).toEqual(['2026-12', '2026-11']);
    expect(monthlyPeriod('2026-12', now)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(monthlyPeriod('2027-01', now)).toBeNull();
  });
});

describe('PeriodRecaps', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows Wrapped automatically in January, with a share card only on request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-15T12:00:00Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(Response.json(recap(url.includes('wrapped') ? 'wrapped' : 'monthly'))),
      ),
    );
    const fixture = TestBed.createComponent(PeriodRecaps);
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(fetch).toHaveBeenCalledWith('/api/insights/recap?type=wrapped', expect.anything());
    expect(fetch).toHaveBeenCalledWith(
      '/api/insights/recap?type=monthly&month=2026-12',
      expect.anything(),
    );
    expect(element.textContent).toContain('2026 Wrapped');
    expect(element.textContent).toContain('December 2026 digest');
    expect(element.textContent).toContain('1,200');
    expect(element.querySelector('img')).toBeNull();
    (element.querySelector('.recap-card button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.querySelector('img')?.getAttribute('src')).toBe(
      '/api/insights/recap/card.png?type=wrapped',
    );
    expect(element.textContent).toContain('Totals include your private activities');
  });

  it('hides Wrapped outside its window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(recap('monthly'))));
    const fixture = TestBed.createComponent(PeriodRecaps);
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).not.toContain('Wrapped');
  });

  it('summarises commits and kilometres for share posts', () => {
    expect(recapSummary(recap('wrapped'), '2026 Wrapped')).toBe(
      'My 2026 Wrapped on Devs Who Move: 1,200 public commits, 800 km, 140 sessions.',
    );
  });
});
