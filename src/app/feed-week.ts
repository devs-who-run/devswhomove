import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
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

  readonly today = new Date();

  readonly weekNumber = computed(() => {
    const date = new Date(
      Date.UTC(this.today.getFullYear(), this.today.getMonth(), this.today.getDate()),
    );
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  });

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const name = this.viewer()?.name.split(' ')[0];
    const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
    return name ? `${part}, ${name}.` : `${part}.`;
  });

  readonly weekly = computed(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return this.activities().filter((activity) => new Date(activity.occurredAt) >= start);
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
    const cursor = new Date();
    if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (days.has(dayKey(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  });
}
