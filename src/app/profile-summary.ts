import { computed } from '@angular/core';
import { localDate } from './date';
import type { Activity, Sport } from './models';

const formatMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  });
};

interface ProfileSummaryContext {
  activities: () => Activity[];
  sport: () => Sport | 'All';
  month: () => string;
}

export class ProfileSummary {
  constructor(private readonly context: ProfileSummaryContext) {}
  readonly months = computed(() =>
    [
      ...new Set(
        this.context
          .activities()
          .map((activity) => localDate(new Date(activity.occurredAt)).slice(0, 7)),
      ),
    ]
      .sort()
      .reverse()
      .map((month) => ({ value: month, label: formatMonth(month) })),
  );
  readonly filteredActivities = computed(() =>
    this.context
      .activities()
      .filter(
        (activity) =>
          (this.context.sport() === 'All' || activity.sport === this.context.sport()) &&
          (this.context.month() === 'All' ||
            localDate(new Date(activity.occurredAt)).slice(0, 7) === this.context.month()),
      ),
  );
  readonly stats = computed(() => {
    const activities = this.context.activities();
    return {
      sessions: activities.length,
      distance: activities.reduce((sum, activity) => sum + (activity.distance || 0), 0),
      hours: activities.reduce((sum, activity) => sum + activity.duration, 0) / 60,
      sports: new Set(activities.map((activity) => activity.sport)).size,
    };
  });
}
