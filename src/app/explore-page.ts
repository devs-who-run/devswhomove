import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ActivityRoute } from './activity-route';
import { errorMessage, request } from './api';
import { Icon } from './icon';
import type { ExploreResult, MappedRoutesResult, Profile, Sport, SportEvent } from './models';
import { SportFilter } from './sport-filter';

export const EXPLORE_RADII = [5, 10, 25, 50, 100] as const;

/** Plain names and icons for OpenStreetMap route types. */
const ROUTE_KINDS: Record<string, { label: string; icon: string }> = {
  running: { label: 'Running route', icon: 'Running' },
  fitness_trail: { label: 'Fitness trail', icon: 'Running' },
  hiking: { label: 'Hiking route', icon: 'Walking' },
  foot: { label: 'Walking route', icon: 'Walking' },
  walking: { label: 'Walking route', icon: 'Walking' },
  bicycle: { label: 'Cycling route', icon: 'Cycling' },
  mtb: { label: 'Mountain bike route', icon: 'Cycling' },
};

/** Sports that OpenStreetMap route types cover. */
const MAPPED_SPORTS: readonly (Sport | 'All')[] = ['All', 'Running', 'Walking', 'Cycling'];

/** Round to about 1 km before a position leaves the browser. */
const coarse = (value: number) => Math.round(value * 100) / 100;

/**
 * Find public routes near you, and upcoming events and people by place name.
 * Location starts from Cloudflare's approximate network location; "Use my location" swaps in
 * the device position, rounded to about 1 km and never stored.
 */
@Component({
  selector: 'app-explore-page',
  imports: [ActivityRoute, DatePipe, DecimalPipe, FormsModule, Icon, RouterLink, SportFilter],
  templateUrl: './explore-page.html',
  styleUrls: ['./page-layout.css', './listing-cards.css', './explore-page.css'],
})
export class ExplorePage {
  readonly viewer = input<Profile | null>(null);
  readonly saving = input(false);
  readonly joinEvent = output<SportEvent>();

  readonly radii = EXPLORE_RADII;
  readonly sport = signal<Sport | 'All'>('All');
  readonly radius = signal<number>(25);
  readonly place = signal('');
  readonly device = signal<{ lat: number; lng: number } | null>(null);
  readonly locating = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly locationNote = signal('');
  readonly result = signal<ExploreResult | null>(null);
  /** Announced after every completed search, even when earlier results stay on screen. */
  readonly summary = signal('');
  /** OpenStreetMap routes, loaded after the main results because Overpass can be slow. */
  readonly mapped = signal<MappedRoutesResult | null>(null);
  readonly mappedLoading = signal(false);
  readonly mappedApplies = computed(() => MAPPED_SPORTS.includes(this.sport()));
  private request = 0;

  /** The next distance up, offered when nothing is shared nearby. */
  readonly widerRadius = computed(
    () => EXPLORE_RADII.find((option) => option > (this.result()?.radius ?? this.radius())) ?? null,
  );

  readonly areaLabel = computed(() => {
    const origin = this.result()?.origin;
    if (!origin) return null;
    if (origin.source === 'device') return 'your location';
    return origin.label ? `${origin.label} (approximate)` : 'your approximate area';
  });

  constructor() {
    void this.search();
  }

  setSport(sport: Sport | 'All'): void {
    this.sport.set(sport);
    void this.search();
  }

  setRadius(radius: number): void {
    this.radius.set(Number(radius));
    void this.search();
  }

  useMyLocation(): void {
    if (!('geolocation' in navigator)) {
      this.locationNote.set('Your browser can’t share a location. Try searching by place instead.');
      return;
    }
    this.locating.set(true);
    this.locationNote.set('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        this.locating.set(false);
        this.device.set({ lat: coarse(coords.latitude), lng: coarse(coords.longitude) });
        void this.search();
      },
      (failure) => {
        this.locating.set(false);
        this.locationNote.set(
          failure.code === failure.PERMISSION_DENIED
            ? 'Location permission was declined. Showing your approximate area instead.'
            : 'We couldn’t find your location. Showing your approximate area instead.',
        );
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 10_000 },
    );
  }

  clearLocation(): void {
    this.device.set(null);
    void this.search();
  }

  async search(): Promise<void> {
    const current = ++this.request;
    const params = new URLSearchParams({ radius: String(this.radius()) });
    const device = this.device();
    if (device) {
      params.set('lat', String(device.lat));
      params.set('lng', String(device.lng));
    }
    if (this.sport() !== 'All') params.set('sport', this.sport());
    if (this.place().trim()) params.set('q', this.place().trim());
    this.loading.set(true);
    try {
      const result = await request<ExploreResult>(`/api/explore?${params}`);
      if (current === this.request) {
        this.result.set(result);
        this.summary.set(this.describe(result));
        this.error.set('');
        void this.loadMapped(current, result);
      }
    } catch (error) {
      if (current === this.request) this.error.set(errorMessage(error));
    } finally {
      if (current === this.request) this.loading.set(false);
    }
  }

  private async loadMapped(current: number, result: ExploreResult): Promise<void> {
    this.mapped.set(null);
    if (!result.origin || !this.mappedApplies()) return;
    const params = new URLSearchParams({
      lat: String(result.origin.lat),
      lng: String(result.origin.lng),
      radius: String(result.radius),
    });
    if (this.sport() !== 'All') params.set('sport', this.sport());
    this.mappedLoading.set(true);
    try {
      const mapped = await request<MappedRoutesResult>(`/api/explore/mapped?${params}`);
      if (current === this.request) this.mapped.set(mapped);
    } catch {
      if (current === this.request) this.mapped.set({ status: 'unavailable', routes: [] });
    } finally {
      if (current === this.request) this.mappedLoading.set(false);
    }
  }

  kind(kind: string): { label: string; icon: string } {
    return ROUTE_KINDS[kind] ?? { label: 'Route', icon: 'Other' };
  }

  private describe(result: ExploreResult): string {
    const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const parts = [
      result.origin ? count(result.routes.length, 'route', 'routes') : 'no location for routes',
      count(result.events.length, 'event', 'events'),
      ...(result.place ? [count(result.people.length, 'person', 'people')] : []),
    ];
    return `Found ${parts.join(', ')}.`;
  }

  pace(distance: number | null, duration: number): string {
    if (!distance) return '';
    const seconds = Math.round((duration * 60) / distance);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} /km`;
  }

  capacityLeft(event: SportEvent): string {
    const left = event.capacity - event.attendees;
    return left > 0 ? `${left} ${left === 1 ? 'spot' : 'spots'} left` : 'Full';
  }
}
