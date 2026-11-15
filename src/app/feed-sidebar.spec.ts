import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ACTIVITIES, DEMO_EVENTS } from './demo';
import { FeedSidebar } from './feed-sidebar';

describe('FeedSidebar', () => {
  afterEach(() => vi.useRealTimers());

  it('summarizes the current week and updates when activities change', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12));
    const activity = DEMO_ACTIVITIES[0];
    const fixture = TestBed.createComponent(FeedSidebar);
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
    fixture.componentRef.setInput('events', []);
    fixture.componentRef.setInput('preview', true);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('.weekly-card')?.textContent).toContain(
      'A glimpse of your future rhythm.',
    );
    expect(html.querySelector('.week-total')?.textContent).toContain('90');
    expect(html.querySelector('.week-footer')?.textContent).toContain('3 sessions');
    expect(html.querySelector('.week-footer')?.textContent).toContain('7.5 km covered');
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
    fixture.detectChanges();
    expect(html.querySelector('.weekly-card')?.textContent).toContain('Small steps. They add up.');
    expect(html.querySelector('.week-total')?.textContent).toContain('0');
    expect(html.querySelector('.week-footer')?.textContent).toContain('0 sessions');
  });

  it('shows two upcoming events and emits the corresponding shortcuts', () => {
    const fixture = TestBed.createComponent(FeedSidebar);
    fixture.componentRef.setInput('activities', []);
    fixture.componentRef.setInput('events', DEMO_EVENTS);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    const navigate = vi.fn();
    const hostEvent = vi.fn();
    fixture.componentInstance.navigate.subscribe(navigate);
    fixture.componentInstance.hostEvent.subscribe(hostEvent);

    const events = html.querySelectorAll<HTMLButtonElement>('.mini-event');
    expect(events).toHaveLength(2);
    expect(events[0].textContent).toContain(DEMO_EVENTS[0].title);
    expect(events[1].textContent).toContain(DEMO_EVENTS[1].title);
    html.querySelector<HTMLButtonElement>('[aria-label="See all events"]')!.click();
    events[0].click();
    html.querySelector<HTMLButtonElement>('.agent-promo button')!.click();
    html.querySelector<HTMLButtonElement>('.host-button')!.click();
    expect(navigate.mock.calls).toEqual([['events'], ['events'], ['agents']]);
    expect(hostEvent).toHaveBeenCalledOnce();

    fixture.componentRef.setInput('events', []);
    fixture.detectChanges();
    expect(html.querySelector('.empty-events')?.textContent).toContain('Host the first event.');
  });
});
