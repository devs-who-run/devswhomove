import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdventCalendar } from './advent-calendar';
import type { Activity, Profile } from './models';

const viewer: Profile = {
  id: 'advent-test-user',
  username: 'mover',
  name: 'Mover',
  avatar: '',
  bio: '',
  location: '',
  sports: [],
  visibility: 'private',
};

const activity = (date: Date): Activity => ({
  id: 'movement-1',
  userId: viewer.id,
  username: viewer.username,
  name: viewer.name,
  avatar: '',
  title: 'A walk',
  sport: 'Walking',
  occurredAt: date.toISOString(),
  duration: 10,
  distance: null,
  notes: '',
  visibility: 'private',
  source: 'web',
});

describe('AdventCalendar', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('keeps prompts unavailable before their local calendar day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 30, 12));
    const fixture = TestBed.createComponent(AdventCalendar);
    fixture.componentRef.setInput('activities', []);
    fixture.componentRef.setInput('viewer', viewer);
    fixture.detectChanges();

    expect(fixture.componentInstance.days()).toHaveLength(25);
    expect(fixture.componentInstance.unlockedDays()).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('No spoilers');
    expect(fixture.nativeElement.textContent).not.toContain('A walk around the block');

    fixture.componentInstance.now.set(new Date(2026, 11, 1, 0, 0));
    fixture.detectChanges();
    expect(fixture.componentInstance.unlockedDays()).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('A walk around the block');
    expect(fixture.nativeElement.textContent).not.toContain('Find your rhythm');
  });

  it('counts only logged movement on unlocked days and lets recovery days count', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 7, 12));
    const fixture = TestBed.createComponent(AdventCalendar);
    fixture.componentRef.setInput('activities', [
      activity(new Date(2026, 11, 1, 10)),
      activity(new Date(2026, 11, 8, 10)),
    ]);
    fixture.componentRef.setInput('viewer', viewer);
    fixture.detectChanges();
    const calendar = fixture.componentInstance;

    expect(calendar.unlockedDays()).toBe(7);
    expect(calendar.completedDays()).toBe(1);
    const recoveryDay = calendar.days()[6];
    calendar.toggleRestDay(recoveryDay);
    expect(calendar.completedDays()).toBe(2);
    expect(
      JSON.parse(localStorage.getItem('devs-who-move:advent:2026:advent-test-user') ?? '[]'),
    ).toContain(recoveryDay.date);

    calendar.now.set(new Date(2026, 11, 8, 0, 0));
    expect(calendar.completedDays()).toBe(3);
  });

  it('keeps recovery check-ins saved in other tabs', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 21, 12));
    const key = 'devs-who-move:advent:2026:advent-test-user';
    const fixture = TestBed.createComponent(AdventCalendar);
    fixture.componentRef.setInput('activities', []);
    fixture.componentRef.setInput('viewer', viewer);
    fixture.detectChanges();
    const calendar = fixture.componentInstance;
    const [day7, day14, day21] = [6, 13, 20].map((index) => calendar.days()[index]);

    // Another tab saves day 7 without a storage event reaching this one.
    localStorage.setItem(key, JSON.stringify([day7.date]));
    calendar.toggleRestDay(day14);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([day7.date, day14.date]);
    expect(calendar.completedDays()).toBe(2);

    // Another tab adds day 21 and the storage event updates this calendar.
    const stored = JSON.stringify([day7.date, day14.date, day21.date]);
    localStorage.setItem(key, stored);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: stored }));
    expect(calendar.completedDays()).toBe(3);

    // Events for other keys are ignored.
    localStorage.setItem(key, '[]');
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: '1' }));
    expect(calendar.completedDays()).toBe(3);
    fixture.destroy();
    localStorage.removeItem(key);
  });

  it('unlocks the next door at local midnight without reloading', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 10, 30, 23, 59, 59));
    const fixture = TestBed.createComponent(AdventCalendar);
    fixture.componentRef.setInput('activities', []);
    fixture.detectChanges();
    expect(fixture.componentInstance.unlockedDays()).toBe(0);

    vi.advanceTimersByTime(1_011);
    expect(fixture.componentInstance.unlockedDays()).toBe(1);
    expect(fixture.componentInstance.selectedDay().date).toBe('2026-12-01');
    fixture.destroy();
  });
});
