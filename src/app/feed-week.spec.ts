import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ACTIVITIES, DEMO_PROFILE } from './demo';
import { FeedWeek, msUntilNextBoundary } from './feed-week';

describe('FeedWeek', () => {
  afterEach(() => vi.useRealTimers());

  it('summarizes the current week and updates when activities change', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12));
    const activity = DEMO_ACTIVITIES[0];
    const fixture = TestBed.createComponent(FeedWeek);
    fixture.componentRef.setInput('activities', [
      {
        ...activity,
        id: 'previous-week',
        occurredAt: new Date(2026, 10, 15, 23).toISOString(),
        duration: 500,
        distance: 100,
      },
      {
        ...activity,
        id: 'monday-run',
        occurredAt: new Date(2026, 10, 16, 8).toISOString(),
        duration: 20,
        distance: 5,
      },
      {
        ...activity,
        id: 'monday-walk',
        occurredAt: new Date(2026, 10, 16, 12).toISOString(),
        duration: 40,
        distance: null,
      },
      {
        ...activity,
        id: 'wednesday',
        occurredAt: new Date(2026, 10, 18, 8).toISOString(),
        duration: 30,
        distance: 2.5,
      },
    ]);
    fixture.componentRef.setInput('preview', true);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('.week-banner')?.textContent).toContain(
      'A glimpse of your future rhythm.',
    );
    expect(html.querySelector('.week-total')?.textContent).toContain('90');
    expect(html.querySelector('.week-stats')?.textContent).toContain('sessions3');
    expect(html.querySelector('.week-stats')?.textContent).toContain('7.5 km');
    expect(html.querySelector('.week-chart')?.getAttribute('aria-label')).toContain(
      'Monday, 60 minutes; Tuesday, 0 minutes; Wednesday, 30 minutes',
    );
    expect(
      (html.querySelector('[title="Monday: 60 minutes"] .bar-track span') as HTMLElement).style
        .height,
    ).toBe('100%');
    expect(
      (html.querySelector('[title="Wednesday: 30 minutes"] .bar-track span') as HTMLElement).style
        .height,
    ).toBe('50%');

    fixture.componentRef.setInput('activities', []);
    fixture.componentRef.setInput('preview', false);
    fixture.componentRef.setInput('viewer', DEMO_PROFILE);
    fixture.detectChanges();
    expect(html.querySelector('h1')?.textContent).toContain('Avery.');
    expect(html.querySelector('.week-banner')?.textContent).toContain('Small steps. They add up.');
    expect(html.querySelector('.week-total')?.textContent).toContain('0');
    expect(html.querySelector('.week-stats')?.textContent).toContain('sessions0');
  });

  it('counts a streak of consecutive days that ends today or yesterday', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 20));
    const activity = DEMO_ACTIVITIES[0];
    const on = (day: number, id: string) => ({
      ...activity,
      id,
      occurredAt: new Date(2026, 10, day, 8).toISOString(),
    });
    const fixture = TestBed.createComponent(FeedWeek);
    fixture.componentRef.setInput('viewer', DEMO_PROFILE);
    fixture.componentRef.setInput('activities', [
      on(17, 'a'),
      on(16, 'b'),
      on(15, 'c'),
      on(13, 'd'),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.streak()).toBe(3);
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toContain(
      '3‑day streak',
    );

    fixture.componentRef.setInput('activities', [on(15, 'c'), on(14, 'd')]);
    fixture.detectChanges();
    expect(fixture.componentInstance.streak()).toBe(0);
  });

  it('only counts activities from Monday up to, but not including, next Monday', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12));
    const activity = DEMO_ACTIVITIES[0];
    const at = (date: Date, id: string, duration: number) => ({
      ...activity,
      id,
      duration,
      distance: null,
      occurredAt: date.toISOString(),
    });
    const fixture = TestBed.createComponent(FeedWeek);
    fixture.componentRef.setInput('activities', [
      at(new Date(2026, 10, 16, 0, 0), 'monday-midnight', 10),
      at(new Date(2026, 10, 22, 23, 59), 'sunday-night', 20),
      at(new Date(2026, 10, 23, 0, 0), 'next-monday', 400),
      at(new Date(2026, 10, 15, 23, 59), 'last-sunday', 800),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.weeklyMinutes()).toBe(30);
    expect(fixture.componentInstance.weekBars()[0].minutes).toBe(10);
    expect(fixture.componentInstance.weekBars()[6].minutes).toBe(20);
  });

  it('refreshes the day, week, greeting, totals and streak at midnight', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 10, 22, 23, 30));
    const fixture = TestBed.createComponent(FeedWeek);
    fixture.componentRef.setInput('viewer', DEMO_PROFILE);
    fixture.componentRef.setInput('activities', [
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2026, 10, 22, 8).toISOString() },
    ]);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('.week-eyebrow')?.textContent).toContain('Sunday · Week 47');
    expect(html.querySelector('h1')?.textContent).toContain('Evening');
    expect(fixture.componentInstance.weekly()).toHaveLength(1);

    vi.advanceTimersByTime(31 * 60_000);
    fixture.detectChanges();
    expect(html.querySelector('.week-eyebrow')?.textContent).toContain('Monday · Week 48');
    expect(html.querySelector('h1')?.textContent).toContain('Morning');
    expect(fixture.componentInstance.weekly()).toHaveLength(0);
    expect(fixture.componentInstance.streak()).toBe(1);
  });

  it('catches up when the page becomes visible again and stops its timer on destroy', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 10, 18, 9));
    const fixture = TestBed.createComponent(FeedWeek);
    fixture.componentRef.setInput('activities', []);
    fixture.detectChanges();
    expect(fixture.componentInstance.today().getDate()).toBe(18);

    // A sleeping laptop can skip timers entirely; resuming the page must still catch up.
    vi.setSystemTime(new Date(2026, 10, 20, 9));
    document.dispatchEvent(new Event('visibilitychange'));
    fixture.detectChanges();
    expect(fixture.componentInstance.today().getDate()).toBe(20);
    expect(vi.getTimerCount()).toBe(1);

    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date(2026, 10, 21, 9));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fixture.componentInstance.today().getDate()).toBe(20);
  });

  it('schedules the next refresh for noon, 6 pm or midnight', () => {
    expect(msUntilNextBoundary(new Date(2026, 10, 18, 9))).toBe(3 * 3_600_000);
    expect(msUntilNextBoundary(new Date(2026, 10, 18, 12))).toBe(6 * 3_600_000);
    expect(msUntilNextBoundary(new Date(2026, 10, 18, 20, 30))).toBe(3.5 * 3_600_000);
  });
});
