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

  it.each([true, false])(
    'prepares the card before enabling Share and shares directly on click (file support: %s)',
    async (supportsFiles) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
      const share = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { share, canShare: () => supportsFiles });
      let resolveCard: ((response: Response) => void) | undefined;
      const cardResponse = new Promise<Response>((resolve) => (resolveCard = resolve));
      const fetch = vi.fn((url: string) =>
        url.includes('card.png') ? cardResponse : Promise.resolve(Response.json(recap('monthly'))),
      );
      vi.stubGlobal('fetch', fetch);
      const fixture = TestBed.createComponent(PeriodRecaps);
      fixture.componentRef.setInput('profile', profile);
      fixture.detectChanges();
      await vi.waitFor(() => expect(fixture.componentInstance.state.monthly().data).not.toBeNull());
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;
      (element.querySelector('.recap-card button') as HTMLButtonElement).click();
      fixture.detectChanges();
      const shareButton = element.querySelector('.share-row button') as HTMLButtonElement;
      expect(shareButton.disabled).toBe(true);
      expect(share).not.toHaveBeenCalled();
      resolveCard?.(new Response('png', { headers: { 'Content-Type': 'image/png' } }));
      await vi.waitFor(() =>
        expect(fixture.componentInstance.state.monthly().shareData).not.toBeNull(),
      );
      fixture.detectChanges();
      expect(shareButton.disabled).toBe(false);
      fetch.mockClear();
      shareButton.click();
      expect(share).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          title: 'October 2026 digest',
          text: recapSummary(recap('monthly'), 'October 2026 digest'),
          url: location.origin,
        }),
      );
      expect(fetch).not.toHaveBeenCalled();
      const data = share.mock.calls[0][0] as ShareData;
      if (supportsFiles) {
        expect(data.files?.[0]).toMatchObject({
          name: 'devs-who-move-2026-10-digest.png',
          type: 'image/png',
          size: 3,
        });
      } else {
        expect(data.files).toBeUndefined();
      }
    },
  );

  it('keeps Share disabled and surfaces card preparation failures', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
    const share = vi.fn();
    vi.stubGlobal('navigator', { share });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes('card.png')
            ? new Response('unavailable', { status: 503 })
            : Response.json(recap('monthly')),
        ),
      ),
    );
    const fixture = TestBed.createComponent(PeriodRecaps);
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.state.monthly().data).not.toBeNull());
    await fixture.componentInstance.showCard('monthly');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect((element.querySelector('.share-row button') as HTMLButtonElement).disabled).toBe(true);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not prepare sharing',
    );
    expect(share).not.toHaveBeenCalled();
  });

  it('resets the monthly label and summary with the selected month on profile refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      share: vi.fn(),
      canShare: () => true,
      clipboard: { writeText },
    });
    let resolveCard: ((response: Response) => void) | undefined;
    const cardResponse = new Promise<Response>((resolve) => (resolveCard = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('card.png') ? cardResponse : Promise.resolve(Response.json(recap('monthly'))),
      ),
    );
    const fixture = TestBed.createComponent(PeriodRecaps);
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.state.monthly().data).not.toBeNull());
    fixture.componentInstance.selectMonth('2026-09');
    await vi.waitFor(() => expect(fixture.componentInstance.state.monthly().data).not.toBeNull());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('September 2026 digest');
    const preparing = fixture.componentInstance.showCard('monthly');
    fixture.componentRef.setInput('profile', { ...profile, id: 'bob', username: 'bob' });
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.state.monthly().data).not.toBeNull());
    resolveCard?.(new Response('old card'));
    await preparing;
    fixture.detectChanges();
    expect(fixture.componentInstance.state.monthly().shareData).toBeNull();
    expect(fixture.componentInstance.state.monthly().showCard).toBe(false);
    expect(fixture.componentInstance.month).toBe('2026-10');
    expect(fixture.nativeElement.textContent).toContain('October 2026 digest');
    expect(fixture.nativeElement.textContent).not.toContain('September 2026 digest');
    await fixture.componentInstance.copySummary('monthly', recap('monthly'));
    expect(writeText).toHaveBeenCalledWith(
      `${recapSummary(recap('monthly'), 'October 2026 digest')} ${location.origin}`,
    );
  });

  it('summarises commits and kilometres for share posts', () => {
    expect(recapSummary(recap('wrapped'), '2026 Wrapped')).toBe(
      'My 2026 Wrapped on Devs Who Move: 1,200 public commits, 800 km, 140 sessions.',
    );
  });
});
