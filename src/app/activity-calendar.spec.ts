import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityCalendar } from './activity-calendar';
import { DEMO_ACTIVITIES } from './demo';

describe('ActivityCalendar', () => {
  afterEach(() => vi.useRealTimers());

  it('shows a continuous last-12-month calendar including rest days and local-day totals', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 15, 12));
    const fixture = TestBed.createComponent(ActivityCalendar);
    fixture.componentRef.setInput('activities', [
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2025, 10, 15, 12).toISOString() },
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2025, 10, 16, 0, 5).toISOString() },
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2026, 10, 15, 23, 55).toISOString() },
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2026, 10, 16, 12).toISOString() },
    ]);
    const calendar = fixture.componentInstance.heatmap();
    expect(calendar.days).toHaveLength(365);
    expect(calendar.days[0].date).toBe('2025-11-16');
    expect(calendar.days.at(-1)?.date).toBe('2026-11-15');
    expect(calendar.sessions).toBe(2);
    expect(calendar.activeDays).toBe(2);
    expect(calendar.days.find((day) => day.date === '2026-05-01')?.count).toBe(0);
    expect(calendar.months.map((month) => month.label)).toContain('May');
    expect(calendar.cells).toHaveLength(calendar.weeks * 7);
    for (const [index, day] of calendar.cells.entries()) {
      if (day) expect(new Date(`${day.date}T12:00:00`).getDay()).toBe(index % 7);
    }
  });

  it('handles leap days, empty years, padding and future dates in calendar-year views', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 1, 29, 12));
    const fixture = TestBed.createComponent(ActivityCalendar);
    fixture.componentRef.setInput('activities', []);
    const calendar = fixture.componentInstance;
    expect(calendar.heatmap().days[0].date).toBe('2023-03-01');
    expect(calendar.heatmap().days.at(-1)?.date).toBe('2024-02-29');
    expect(calendar.heatmap().days).toHaveLength(366);
    calendar.year.set('2024');
    fixture.componentRef.setInput('activities', [
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2024, 1, 29, 12).toISOString() },
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2024, 2, 1, 12).toISOString() },
    ]);
    expect(calendar.heatmap().days).toHaveLength(366);
    expect(calendar.heatmap().cells[0]).toBeNull();
    expect(calendar.heatmap().cells[1]?.date).toBe('2024-01-01');
    expect(calendar.heatmap().days.find((day) => day.date === '2024-02-29')?.count).toBe(1);
    expect(calendar.heatmap().days.find((day) => day.date === '2024-03-01')?.future).toBe(true);
    expect(calendar.heatmap().sessions).toBe(1);
    calendar.year.set('2023');
    expect(calendar.heatmap().days).toHaveLength(365);
    expect(calendar.heatmap().sessions).toBe(0);
    expect(calendar.heatmap().months).toHaveLength(12);
    fixture.componentRef.setInput('activities', [
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2022, 0, 1, 12).toISOString() },
    ]);
    expect(calendar.years()).toEqual([2024, 2023, 2022]);
  });
});
