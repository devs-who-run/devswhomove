import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { localDate } from './date';
import { SPORTS, type Activity, type Sport } from './models';

@Component({
  selector: 'app-activity-calendar',
  imports: [FormsModule],
  templateUrl: './activity-calendar.html',
  styleUrl: './activity-calendar.css',
})
export class ActivityCalendar {
  readonly activities = input.required<Activity[]>();
  readonly sport = model<Sport | 'All'>('All');
  readonly year = model('last-12-months');
  readonly sports = SPORTS;

  readonly years = computed(() => {
    const currentYear = new Date().getFullYear();
    const firstYear = this.activities().reduce(
      (year, activity) => Math.min(year, new Date(activity.occurredAt).getFullYear()),
      currentYear,
    );
    return Array.from({ length: currentYear - firstYear + 1 }, (_, index) => currentYear - index);
  });

  readonly heatmap = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const year = this.year();
    const end = year === 'last-12-months' ? today : new Date(Number(year), 11, 31);
    const start =
      year === 'last-12-months'
        ? new Date(today.getFullYear() - 1, today.getMonth(), 1)
        : new Date(Number(year), 0, 1);
    if (year === 'last-12-months') {
      start.setDate(
        Math.min(today.getDate(), new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()),
      );
      start.setDate(start.getDate() + 1);
    }
    const activitiesByDay = new Map<string, Activity[]>();
    for (const activity of this.activities()) {
      if (this.sport() !== 'All' && activity.sport !== this.sport()) continue;
      const day = localDate(new Date(activity.occurredAt)).slice(0, 10);
      const activities = activitiesByDay.get(day) ?? [];
      activities.push(activity);
      activitiesByDay.set(day, activities);
    }
    const days = [];
    const months: { label: string; column: number }[] = [];
    const offset = start.getDay();
    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      if (date.getDate() === 1 || (days.length === 0 && date.getDate() <= 21)) {
        months.push({
          label: date.toLocaleDateString(undefined, { month: 'short' }),
          column: Math.floor((offset + days.length) / 7) + 1,
        });
      }
      const activities =
        date <= today ? (activitiesByDay.get(localDate(date).slice(0, 10)) ?? []) : [];
      const count = activities.length;
      const minutes = activities.reduce((sum, activity) => sum + activity.duration, 0);
      const distances = activities.flatMap((activity) =>
        activity.distance === null ? [] : [activity.distance],
      );
      const sports = [...new Set(activities.map((activity) => activity.sport))];
      const dateLabel = date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const format = (value: number) =>
        value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      days.push({
        date: localDate(date).slice(0, 10),
        count,
        future: date > today,
        summary: `${dateLabel}: ${count} ${count === 1 ? 'session' : 'sessions'}${
          count ? ` · ${sports.join(', ')} · ${format(minutes)} min` : ''
        }${distances.length ? ` · ${format(distances.reduce((sum, distance) => sum + distance, 0))} km recorded` : ''}`,
      });
    }
    const cells = [
      ...Array<null>(offset).fill(null),
      ...days,
      ...Array<null>((7 - ((offset + days.length) % 7)) % 7).fill(null),
    ];
    const sessions = days.reduce((sum, day) => sum + day.count, 0);
    const period = year === 'last-12-months' ? 'the last 12 months' : year;
    return {
      cells,
      days,
      months,
      weeks: cells.length / 7,
      sessions,
      activeDays: days.filter((day) => day.count > 0).length,
      period,
    };
  });
}
