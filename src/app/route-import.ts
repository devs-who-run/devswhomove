import { computed, signal } from '@angular/core';
import { readWorkoutWithTrack, type ParsedActivity } from './activity-import-parsers';
import { shareableRoute, type TrackPoint, type TrimMeters } from './route-geometry';
import type { RouteVisibility } from './models';

const MAX_WORKOUT_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Holds a workout file chosen in the activity form. The GPS track stays in memory only; just the
 * trimmed, simplified route is ever uploaded, and only when the activity is saved.
 */
export class RouteImport {
  readonly fileName = signal('');
  readonly trimMeters = signal<TrimMeters>(500);
  readonly visibility = signal<RouteVisibility>('hidden');
  readonly busy = signal(false);
  private readonly track = signal<TrackPoint[] | null>(null);
  private requestId = 0;

  /** Whether the chosen file had GPS positions at all (indoor workouts have none). */
  readonly hasTrack = computed(() => (this.track()?.length ?? 0) >= 2);

  /** The route that will be uploaded, recomputed when the privacy zone changes. */
  readonly segments = computed(() => {
    const track = this.track();
    return track && track.length >= 2 ? shareableRoute(track, this.trimMeters()) : null;
  });

  /** Read a chosen file. Returns the workout summary for filling in the form. */
  async load(file: File): Promise<ParsedActivity | null> {
    const requestId = ++this.requestId;
    if (file.size > MAX_WORKOUT_FILE_BYTES)
      throw new Error('Choose a workout file smaller than 50 MB.');
    this.busy.set(true);
    try {
      const { activity, track } = await readWorkoutWithTrack(file);
      if (requestId !== this.requestId) return null;
      this.track.set(track);
      this.fileName.set(file.name);
      return activity;
    } finally {
      if (requestId === this.requestId) this.busy.set(false);
    }
  }

  reset(): void {
    this.requestId++;
    this.busy.set(false);
    this.track.set(null);
    this.fileName.set('');
    this.trimMeters.set(500);
    this.visibility.set('hidden');
  }
}
