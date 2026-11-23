import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_EVENTS } from './demo';
import { FeedSidebar } from './feed-sidebar';

describe('FeedSidebar', () => {
  it('shows two upcoming events and emits the corresponding shortcuts', () => {
    const fixture = TestBed.createComponent(FeedSidebar);
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
    html.querySelector<HTMLButtonElement>('.clubs-promo button')!.click();
    html.querySelector<HTMLButtonElement>('.host-button')!.click();
    expect(navigate.mock.calls).toEqual([['events'], ['events'], ['agents'], ['clubs']]);
    expect(hostEvent).toHaveBeenCalledOnce();

    fixture.componentRef.setInput('events', []);
    fixture.detectChanges();
    expect(html.querySelector('.empty-events')?.textContent).toContain('Host the first event.');
  });
});
