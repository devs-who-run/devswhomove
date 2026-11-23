import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ACTIVITIES, DEMO_PROFILE } from './demo';
import { FeedWeek } from './feed-week';

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
});
