import { computed, signal, type WritableSignal } from '@angular/core';
import { request } from './api';
import type { Activity, Visibility } from './models';

interface ActivityActionsContext {
  activities(): Activity[];
  filteredActivities(): Activity[];
  profileHidden(): boolean;
  saving(): boolean;
  action(work: () => Promise<void>): Promise<void>;
  load(): Promise<void>;
  notice: WritableSignal<string>;
}

export class ActivityActions {
  readonly bulkVisibilityMode = signal(false);
  readonly selectedActivityIds = signal<string[]>([]);
  readonly selectedCount = computed(
    () =>
      this.context
        .activities()
        .filter((activity) => this.selectedActivityIds().includes(activity.id)).length,
  );

  constructor(private readonly context: ActivityActionsContext) {}

  reset(): void {
    this.bulkVisibilityMode.set(false);
    this.selectedActivityIds.set([]);
  }

  async toggleVisibility(activity: Activity): Promise<void> {
    const next = activity.visibility === 'public' ? 'private' : 'public';
    if (
      next === 'public' &&
      !window.confirm(
        this.context.profileHidden()
          ? 'Make this activity public? Your profile is private, so it stays hidden until you make your profile public.'
          : 'Make this activity public? It will appear in the community feed.',
      )
    )
      return;
    await this.context.action(async () => {
      await request(`/api/activities/${encodeURIComponent(activity.id)}`, 'PATCH', {
        visibility: next,
      });
      await this.context.load();
      this.context.notice.set(
        next === 'public' && this.context.profileHidden()
          ? 'Activity is now public, but your profile is private. Make your profile public to share it.'
          : `Activity is now ${next}.`,
      );
    });
  }

  toggleBulkVisibilityMode(): void {
    this.bulkVisibilityMode.update((enabled) => !enabled);
    this.selectedActivityIds.set([]);
  }

  toggleActivitySelection(activityId: string): void {
    this.selectedActivityIds.update((ids) =>
      ids.includes(activityId) ? ids.filter((id) => id !== activityId) : [...ids, activityId],
    );
  }

  selectAllProfileActivities(): void {
    this.selectedActivityIds.set(
      this.context
        .filteredActivities()
        .slice(0, 100)
        .map((activity) => activity.id),
    );
  }

  clearActivitySelection(): void {
    this.selectedActivityIds.set([]);
  }

  async setSelectedVisibility(next: Visibility): Promise<void> {
    const ids = this.context
      .activities()
      .filter((activity) => this.selectedActivityIds().includes(activity.id))
      .map((activity) => activity.id);
    if (!ids.length || this.context.saving()) return;
    if (
      next === 'public' &&
      !window.confirm(
        `Make ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'} public? ${
          this.context.profileHidden()
            ? 'Your profile is private, so they stay hidden until you make your profile public.'
            : 'They will appear in the community feed.'
        }`,
      )
    )
      return;
    await this.context.action(async () => {
      await request('/api/activities/bulk-visibility', 'PATCH', { ids, visibility: next });
      await this.context.load();
      this.reset();
      this.context.notice.set(
        `${ids.length} ${ids.length === 1 ? 'activity is' : 'activities are'} now ${next}.${
          next === 'public' && this.context.profileHidden()
            ? ' Make your profile public to share them.'
            : ''
        }`,
      );
    });
  }

  async deleteActivity(activity: Activity): Promise<void> {
    if (!window.confirm(`Delete "${activity.title}"? This cannot be undone.`)) return;
    await this.context.action(async () => {
      await request(`/api/activities/${encodeURIComponent(activity.id)}`, 'DELETE');
      await this.context.load();
      this.context.notice.set('Activity deleted.');
    });
  }
}
