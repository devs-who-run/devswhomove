import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { Icon } from './icon';
import type { Activity, SportEvent } from './models';

@Component({
  selector: 'app-feed-sidebar',
  imports: [DatePipe, DecimalPipe, Icon],
  templateUrl: './feed-sidebar.html',
  styleUrl: './feed-sidebar.css',
})
export class FeedSidebar {
  readonly activities = input.required<Activity[]>();
  readonly events = input.required<SportEvent[]>();
  readonly preview = input(false);
  readonly navigate = output<'events' | 'agents'>();
  readonly hostEvent = output<void>();

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
    const days = [
      ['Monday', 'M'],
      ['Tuesday', 'T'],
      ['Wednesday', 'W'],
      ['Thursday', 'T'],
      ['Friday', 'F'],
      ['Saturday', 'S'],
      ['Sunday', 'S'],
    ] as const;
    return minutes.map((value, index) => ({
      day: days[index][0],
      shortDay: days[index][1],
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
}
