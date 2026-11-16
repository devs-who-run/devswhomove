import { computed, signal, type WritableSignal } from '@angular/core';
import { errorMessage, request } from './api';
import { DEMO_PROFILE } from './demo';
import type { FeedMode } from './feed-page';
import type { Activity, Profile, Sport } from './models';

interface FeedContext {
  activities: () => Activity[];
  viewer: () => Profile | null;
  selectedSport: () => Sport | 'All';
  signedIn: () => boolean;
  error: WritableSignal<string>;
}

export class FeedState {
  constructor(private readonly context: FeedContext) {}
  readonly mode = signal<FeedMode>('community');
  readonly followingActivities = signal<Activity[]>([]);
  readonly followingLoading = signal(false);
  private followingRequest = 0;

  readonly filteredActivities = computed(() =>
    (this.mode() === 'following' ? this.followingActivities() : this.context.activities()).filter(
      (activity) =>
        (this.context.selectedSport() === 'All' ||
          activity.sport === this.context.selectedSport()) &&
        (this.mode() !== 'mine' ||
          activity.userId === (this.context.viewer()?.id || DEMO_PROFILE.id)),
    ),
  );
  readonly myActivities = computed(() =>
    this.context
      .activities()
      .filter((activity) => activity.userId === (this.context.viewer()?.id || DEMO_PROFILE.id)),
  );

  async setMode(mode: FeedMode): Promise<void> {
    if (mode === 'following' && !this.context.signedIn()) return;
    this.mode.set(mode);
    if (mode !== 'following') return;
    const requestId = ++this.followingRequest;
    this.followingLoading.set(true);
    try {
      const data = await request<{ activities: Activity[] }>('/api/feed?scope=following');
      if (requestId === this.followingRequest) this.followingActivities.set(data.activities);
    } catch (error) {
      if (requestId === this.followingRequest) this.context.error.set(errorMessage(error));
    } finally {
      if (requestId === this.followingRequest) this.followingLoading.set(false);
    }
  }

  clear(): void {
    this.mode.set('community');
    this.followingRequest++;
    this.followingActivities.set([]);
    this.followingLoading.set(false);
  }
}
