import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Icon } from './icon';
import { Theme } from './theme';
import { DEMO_ACTIVITIES, DEMO_EVENTS, DEMO_PROFILE } from './demo';
import {
  SPORTS,
  type Activity,
  type AgentScope,
  type AgentToken,
  type Bootstrap,
  type Profile,
  type Sport,
  type SportEvent,
  type Visibility,
} from './models';

type Page = 'feed' | 'events' | 'profile' | 'agents';
type Modal = 'activity' | 'event' | 'profile' | null;
const localDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

@Component({
  imports: [DatePipe, DecimalPipe, FormsModule, Icon, RouterLink, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
  readonly theme = inject(Theme);
  readonly sports = SPORTS;
  readonly nav: { page: Page; label: string; icon: string }[] = [
    { page: 'feed', label: 'The community', icon: 'grid' },
    { page: 'events', label: 'Move together', icon: 'calendar' },
    { page: 'profile', label: 'Your profile', icon: 'user' },
    { page: 'agents', label: 'Your agents', icon: 'terminal' },
  ];
  readonly page = signal<Page>('feed');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly viewer = signal<Profile | null>(null);
  readonly liveActivities = signal<Activity[]>([]);
  readonly liveEvents = signal<SportEvent[]>([]);
  readonly githubConfigured = signal(false);
  readonly preview = signal(false);
  readonly selectedSport = signal<Sport | 'All'>('All');
  readonly feedMode = signal<'community' | 'mine'>('community');
  readonly modal = signal<Modal>(null);
  readonly tokens = signal<AgentToken[]>([]);
  readonly newToken = signal('');
  readonly remoteProfile = signal<Profile | null>(null);
  readonly remoteActivities = signal<Activity[]>([]);
  readonly profileLoading = signal(false);
  readonly profileError = signal('');
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private routeRequest = 0;

  readonly activities = computed(() => (this.preview() ? DEMO_ACTIVITIES : this.liveActivities()));
  readonly events = computed(() => (this.preview() ? DEMO_EVENTS : this.liveEvents()));
  readonly displayedProfile = computed(() => this.remoteProfile() || this.viewer());
  readonly profileActivities = computed(() =>
    this.remoteProfile()
      ? this.remoteActivities()
      : this.activities().filter((activity) => activity.userId === this.displayedProfile()?.id),
  );
  readonly filteredActivities = computed(() =>
    this.activities().filter(
      (activity) =>
        (this.selectedSport() === 'All' || activity.sport === this.selectedSport()) &&
        (this.feedMode() === 'community' ||
          activity.userId === (this.viewer()?.id || DEMO_PROFILE.id)),
    ),
  );
  readonly filteredEvents = computed(() =>
    this.events().filter(
      (event) => this.selectedSport() === 'All' || event.sport === this.selectedSport(),
    ),
  );
  readonly myActivities = computed(() =>
    this.activities().filter(
      (activity) => activity.userId === (this.viewer()?.id || DEMO_PROFILE.id),
    ),
  );
  readonly weekly = computed(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return this.myActivities().filter((activity) => new Date(activity.occurredAt) >= start);
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
      day: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][index],
      minutes: value,
      height: (value / max) * 100,
    }));
  });
  readonly profileStats = computed(() => {
    const activities = this.profileActivities();
    return {
      sessions: activities.length,
      distance: activities.reduce((sum, activity) => sum + (activity.distance || 0), 0),
      hours: activities.reduce((sum, activity) => sum + activity.duration, 0) / 60,
      sports: new Set(activities.map((activity) => activity.sport)).size,
    };
  });
  readonly heatmap = computed(() => {
    const activities = this.profileActivities();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 91 }, (_, index) => {
      const date = new Date(today);
      date.setDate(date.getDate() - 90 + index);
      const count = activities.filter(
        (activity) => new Date(activity.occurredAt).toDateString() === date.toDateString(),
      ).length;
      return {
        date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        count,
      };
    });
  });

  activityForm = this.emptyActivity();
  eventForm = this.emptyEvent();
  profileForm = {
    name: '',
    bio: '',
    location: '',
    visibility: 'private' as Visibility,
    sports: [] as Sport[],
  };
  agentName = '';
  agentWrite = true;
  agentRead = true;
  agentEvents = false;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd && !this.loading()) void this.route();
    });
    void this.load().then(() => this.route());
  }

  private emptyActivity() {
    return {
      title: '',
      sport: 'Running' as Sport,
      occurredAt: localDate(new Date()),
      duration: 30,
      distance: null as number | null,
      notes: '',
      visibility: 'private' as Visibility,
    };
  }

  private emptyEvent() {
    const tomorrow = new Date(Date.now() + 86400_000);
    tomorrow.setHours(9, 0, 0, 0);
    return {
      title: '',
      sport: 'Running' as Sport,
      startsAt: localDate(tomorrow),
      location: '',
      description: '',
      level: 'All levels welcome',
      capacity: 12,
    };
  }

  private async api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...(data === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    });
    if (response.status === 204) return undefined as T;
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || 'The request failed. Please try again.');
    return result;
  }

  async load(): Promise<void> {
    try {
      const data = await this.api<Bootstrap>('/api/bootstrap');
      this.viewer.set(data.viewer);
      this.liveActivities.set(data.activities);
      this.liveEvents.set(data.events);
      this.githubConfigured.set(data.githubConfigured);
      this.preview.set(!data.viewer && data.activities.length === 0 && data.events.length === 0);
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.loading.set(false);
    }
  }

  navigate(page: Page): void {
    void this.router.navigateByUrl(`/${page}`);
  }

  async route(): Promise<void> {
    const request = ++this.routeRequest;
    const [page, username] = new URL(this.router.url, window.location.origin).pathname
      .slice(1)
      .split('/');
    this.page.set(this.nav.some((item) => item.page === page) ? (page as Page) : 'feed');
    if (this.page() !== 'agents') this.newToken.set('');
    this.selectedSport.set('All');
    this.remoteProfile.set(null);
    this.remoteActivities.set([]);
    this.profileError.set('');
    this.profileLoading.set(false);
    if (page === 'profile' && username && username !== this.viewer()?.username) {
      this.profileLoading.set(true);
      try {
        const data = await this.api<{ profile: Profile; activities: Activity[] }>(
          `/api/profiles/${encodeURIComponent(username)}`,
        );
        if (request === this.routeRequest) {
          this.remoteProfile.set(data.profile);
          this.remoteActivities.set(data.activities);
        }
      } catch (error) {
        if (request === this.routeRequest) this.profileError.set(this.message(error));
      } finally {
        if (request === this.routeRequest) this.profileLoading.set(false);
      }
    }
    if (page === 'agents' && this.viewer()) await this.loadTokens();
  }

  login(): void {
    if (!this.githubConfigured()) {
      this.error.set(
        'GitHub sign-in needs setup: add the GitHub OAuth client ID and secret to the Worker. See README.md.',
      );
      return;
    }
    window.location.assign('/auth/github');
  }

  private signedIn(): boolean {
    if (this.viewer()) return true;
    this.notice.set(
      'Your story starts here. Sign in with GitHub to log an activity, join an event, or connect an agent.',
    );
    return false;
  }

  openModal(modal: Exclude<Modal, null>): void {
    if (!this.signedIn()) return;
    this.error.set('');
    this.notice.set('');
    if (modal === 'activity') this.activityForm = this.emptyActivity();
    if (modal === 'event') this.eventForm = this.emptyEvent();
    if (modal === 'profile') {
      const user = this.viewer()!;
      this.profileForm = {
        name: user.name,
        bio: user.bio,
        location: user.location,
        visibility: user.visibility,
        sports: [...user.sports],
      };
    }
    this.modal.set(modal);
    this.dialog()?.nativeElement.showModal();
  }

  closeModal(): void {
    if (this.saving()) return;
    this.dialog()?.nativeElement.close();
    this.modal.set(null);
  }

  toggleSport(sport: Sport): void {
    this.profileForm.sports = this.profileForm.sports.includes(sport)
      ? this.profileForm.sports.filter((item) => item !== sport)
      : [...this.profileForm.sports, sport];
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      if (this.modal() === 'activity') {
        await this.api('/api/activities', 'POST', {
          ...this.activityForm,
          occurredAt: new Date(this.activityForm.occurredAt).toISOString(),
        });
        this.notice.set('Activity logged. Every little move counts.');
      } else if (this.modal() === 'event') {
        await this.api('/api/events', 'POST', {
          ...this.eventForm,
          startsAt: new Date(this.eventForm.startsAt).toISOString(),
        });
        this.notice.set('Event created. You are on the list as host.');
        this.navigate('events');
      } else {
        await this.api('/api/me', 'PATCH', this.profileForm);
        this.notice.set('Profile updated. Your privacy, your call.');
      }
      await this.load();
      this.saving.set(false);
      this.closeModal();
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.saving.set(false);
    }
  }

  async join(event: SportEvent): Promise<void> {
    if (!this.signedIn()) return;
    await this.action(async () => {
      await this.api(`/api/events/${event.id}/join`, 'POST', { join: !event.joined });
      this.notice.set(
        event.joined
          ? 'You have left the event.'
          : 'You are in! The event is now in your upcoming sessions.',
      );
      await this.load();
    });
  }

  async cancelEvent(event: SportEvent): Promise<void> {
    if (!window.confirm(`Cancel "${event.title}" for everyone?`)) return;
    await this.action(async () => {
      await this.api(`/api/events/${event.id}`, 'POST', {});
      await this.load();
      this.notice.set('Event cancelled. It is no longer available to join.');
    });
  }

  async toggleVisibility(activity: Activity): Promise<void> {
    const next = activity.visibility === 'public' ? 'private' : 'public';
    if (
      next === 'public' &&
      !window.confirm(
        'Make this activity public? It will appear in the community when your profile is public.',
      )
    )
      return;
    await this.action(async () => {
      await this.api(`/api/activities/${activity.id}`, 'PATCH', { visibility: next });
      await this.load();
      this.notice.set(`Activity is now ${next}.`);
    });
  }

  async deleteActivity(activity: Activity): Promise<void> {
    if (!window.confirm(`Delete "${activity.title}"? This cannot be undone.`)) return;
    await this.action(async () => {
      await this.api(`/api/activities/${activity.id}`, 'DELETE');
      await this.load();
      this.notice.set('Activity deleted.');
    });
  }

  async loadTokens(): Promise<void> {
    try {
      this.tokens.set((await this.api<{ tokens: AgentToken[] }>('/api/tokens')).tokens);
    } catch (error) {
      this.error.set(this.message(error));
    }
  }

  async createToken(): Promise<void> {
    if (!this.signedIn()) return;
    await this.action(async () => {
      const scopes: AgentScope[] = [];
      if (this.agentRead) scopes.push('activities:read');
      if (this.agentWrite) scopes.push('activities:write');
      if (this.agentEvents) scopes.push('events:read');
      const result = await this.api<{ token: string }>('/api/tokens', 'POST', {
        name: this.agentName,
        scopes,
      });
      this.newToken.set(result.token);
      this.agentName = '';
      await this.loadTokens();
    });
  }

  async revokeToken(token: AgentToken): Promise<void> {
    if (!window.confirm(`Revoke access for "${token.name}"?`)) return;
    await this.action(async () => {
      await this.api(`/api/tokens/${token.id}`, 'DELETE');
      this.newToken.set('');
      await this.loadTokens();
      this.notice.set('Agent access revoked.');
    });
  }

  async logout(): Promise<void> {
    await this.action(async () => {
      await this.api('/api/logout', 'POST', {});
      this.newToken.set('');
      this.tokens.set([]);
      this.remoteProfile.set(null);
      await this.load();
      this.navigate('feed');
    });
  }

  private async action(work: () => Promise<void>): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await work();
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.saving.set(false);
    }
  }

  initials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  pace(activity: Activity): string {
    if (!activity.distance) return '';
    const seconds = Math.round((activity.duration * 60) / activity.distance);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  }
}
