import { DatePipe, DecimalPipe, DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import type { Activity, Profile } from './models';

const DAYS = [
  ['Monday', 'M'],
  ['Tuesday', 'T'],
  ['Wednesday', 'W'],
  ['Thursday', 'T'],
  ['Friday', 'F'],
  ['Saturday', 'S'],
  ['Sunday', 'S'],
] as const;

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Milliseconds until the next time the banner's text can change: noon, 6 pm or midnight. */
export function msUntilNextBoundary(now: Date): number {
  const next = [12, 18, 24]
    .map((hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour))
    .find((boundary) => boundary > now)!;
  return next.getTime() - now.getTime();
}

/** The feed's opening banner: a greeting plus this week's minutes, distance and streak. */
@Component({
  selector: 'app-feed-week',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './feed-week.html',
  styleUrl: './feed-week.css',
})
export class FeedWeek {
  readonly activities = input.required<Activity[]>();
  readonly viewer = input<Profile | null>(null);
  readonly preview = input(false);

  private readonly clock = signal(new Date());
  /** The current time; refreshed at noon, 6 pm and midnight, and when the page becomes visible. */
  readonly today = this.clock.asReadonly();

  constructor() {
    const document = inject(DOCUMENT);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      this.clock.set(new Date());
      // A little past the boundary so a timer that fires a few milliseconds early still crosses it.
      timer = setTimeout(tick, msUntilNextBoundary(this.clock()) + 1000);
    };
    const resume = () => {
      if (document.visibilityState === 'visible') tick();
    };
    tick();
    document.addEventListener('visibilitychange', resume);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
    });
  }

  readonly weekNumber = computed(() => {
    const today = this.today();
    const date = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  });

  readonly greeting = computed(() => {
    const hour = this.today().getHours();
    const name = this.viewer()?.name.split(' ')[0];
    const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
    return name ? `${part}, ${name}.` : `${part}.`;
  });

  readonly weekly = computed(() => {
    const start = new Date(this.today());
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const nextMonday = new Date(start);
    nextMonday.setDate(start.getDate() + 7);
    return this.activities().filter((activity) => {
      const occurredAt = new Date(activity.occurredAt);
      return occurredAt >= start && occurredAt < nextMonday;
    });
  });
  readonly weeklyMinutes = computed(() =>
    this.weekly().reduce((sum, activity) => sum + activity.duration, 0),
  );
  readonly weeklyDistance = computed(() =>
    this.weekly().reduce((sum, activity) => sum + (activity.distance || 0), 0),
  );
  readonly weekBars = computed(() => {
    const minutes = Array<number>(7).fill(0);
    for (const activity of this.weekly())
      minutes[(new Date(activity.occurredAt).getDay() + 6) % 7] += activity.duration;
    const max = Math.max(60, ...minutes);
    return minutes.map((value, index) => ({
      day: DAYS[index][0],
      shortDay: DAYS[index][1],
      minutes: value,
      height: (value / max) * 100,
    }));
  });
  readonly weekChartLabel = computed(
    () =>
      `Activity minutes this week: ${this.weekBars()
        .map((bar) => `${bar.day}, ${bar.minutes} minutes`)
        .join('; ')}.`,
  );

  /** Consecutive days with movement, ending today (or yesterday, so the streak survives until tonight). */
  readonly streak = computed(() => {
    const days = new Set(
      this.activities().map((activity) => dayKey(new Date(activity.occurredAt))),
    );
    const cursor = new Date(this.today());
    if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (days.has(dayKey(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  });
}
