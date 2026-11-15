import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivityCard } from './activity-card';
import type { Participation } from './activity-social';
import { errorMessage, request } from './api';
import { Icon } from './icon';
import { Theme } from './theme';
import { preparePhoto } from './photo';
import { DEMO_ACTIVITIES, DEMO_EVENTS, DEMO_PROFILE } from './demo';
import { SportFilter } from './sport-filter';
import { DeveloperInsights } from './developer-insights';
import {
  SPORTS,
  type Activity,
  type AgentScope,
  type AgentToken,
  type Bootstrap,
  type Club,
  type ClubDetail,
  type EventAttendee,
  type Profile,
  type ProfileSocial,
  type Sport,
  type SportEvent,
  type Visibility,
} from './models';

type Page = 'feed' | 'events' | 'clubs' | 'profile' | 'agents' | 'activity';
type Modal = 'activity' | 'event' | 'profile' | 'club' | 'atproto-login' | null;
const localDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const formatMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  });
};

@Component({
  imports: [
    ActivityCard,
    DatePipe,
    DecimalPipe,
    FormsModule,
    Icon,
    RouterLink,
    RouterOutlet,
    SportFilter,
    DeveloperInsights,
  ],
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
    { page: 'clubs', label: 'Clubs', icon: 'people' },
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
  readonly atprotoConfigured = signal(false);
  readonly preview = signal(false);
  readonly selectedSport = signal<Sport | 'All'>('All');
  readonly feedMode = signal<'community' | 'following' | 'mine'>('community');
  readonly followingActivities = signal<Activity[]>([]);
  readonly followingLoading = signal(false);
  readonly clubs = signal<Club[]>([]);
  readonly clubDetail = signal<ClubDetail | null>(null);
  readonly clubLoading = signal(false);
  readonly clubError = signal('');
  readonly socialCounts = signal<ProfileSocial | null>(null);
  readonly joinedClubs = computed(() => this.clubs().filter((club) => club.joined));
  readonly bulkVisibilityMode = signal(false);
  readonly selectedActivityIds = signal<string[]>([]);
  readonly modal = signal<Modal>(null);
  atprotoHandle = '';
  readonly tokens = signal<AgentToken[]>([]);
  readonly newToken = signal('');
  readonly remoteProfile = signal<Profile | null>(null);
  readonly remoteActivities = signal<Activity[]>([]);
  readonly ownProfileActivities = signal<Activity[]>([]);
  readonly profileMonth = signal('All');
  readonly profileSport = signal<Sport | 'All'>('All');
  readonly profileLoading = signal(false);
  readonly profileError = signal('');
  readonly sharedActivity = signal<Activity | null>(null);
  readonly sharedActivityLoading = signal(false);
  readonly sharedActivityError = signal('');
  readonly photo = signal<Blob | null>(null);
  readonly photoPreview = signal('');
  readonly photoBusy = signal(false);
  readonly publicDisclosure = signal(false);
  readonly editingEvent = signal<string | null>(null);
  readonly attendeeEvent = signal<string | null>(null);
  readonly eventAttendees = signal<EventAttendee[]>([]);
  readonly loadingAttendees = signal<string | null>(null);
  preparePhoto = preparePhoto;
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private routeRequest = 0;
  private followingRequest = 0;
  private editingClubId: string | null = null;
  private attendeeRequest = 0;

  readonly activities = computed(() => (this.preview() ? DEMO_ACTIVITIES : this.liveActivities()));
  readonly events = computed(() => (this.preview() ? DEMO_EVENTS : this.liveEvents()));
  readonly displayedProfile = computed(() => this.remoteProfile() || this.viewer());
  /** Kudos, comments, follows, and clubs need a public profile. */
  readonly participation = computed<Participation>(() => {
    const viewer = this.viewer();
    if (!viewer) return 'anonymous';
    return viewer.visibility === 'public' ? 'ok' : 'private';
  });
  /** Public activities from a private GitHub profile are not shared with anyone else. */
  readonly profileHidden = computed(() => {
    const viewer = this.viewer();
    return !!viewer && viewer.provider !== 'atproto' && viewer.visibility === 'private';
  });
  readonly profileActivities = computed(() =>
    this.remoteProfile() ? this.remoteActivities() : this.ownProfileActivities(),
  );
  readonly profileMonths = computed(() =>
    [
      ...new Set(
        this.profileActivities().map((activity) =>
          localDate(new Date(activity.occurredAt)).slice(0, 7),
        ),
      ),
    ]
      .sort()
      .reverse()
      .map((month) => ({ value: month, label: formatMonth(month) })),
  );
  readonly filteredProfileActivities = computed(() =>
    this.profileActivities().filter(
      (activity) =>
        (this.profileSport() === 'All' || activity.sport === this.profileSport()) &&
        (this.profileMonth() === 'All' ||
          localDate(new Date(activity.occurredAt)).slice(0, 7) === this.profileMonth()),
    ),
  );
  readonly filteredActivities = computed(() =>
    (this.feedMode() === 'following' ? this.followingActivities() : this.activities()).filter(
      (activity) =>
        (this.selectedSport() === 'All' || activity.sport === this.selectedSport()) &&
        (this.feedMode() !== 'mine' || activity.userId === (this.viewer()?.id || DEMO_PROFILE.id)),
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
  readonly selectedProfileActivityCount = computed(
    () =>
      this.profileActivities().filter((activity) =>
        this.selectedActivityIds().includes(activity.id),
      ).length,
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
  readonly profileStats = computed(() => {
    const activities = this.profileActivities();
    return {
      sessions: activities.length,
      distance: activities.reduce((sum, activity) => sum + (activity.distance || 0), 0),
      hours: activities.reduce((sum, activity) => sum + activity.duration, 0) / 60,
      sports: new Set(activities.map((activity) => activity.sport)).size,
    };
  });
  readonly heatmapMonths = computed(() => {
    const activitiesByDay = new Map<string, Activity[]>();
    for (const activity of this.filteredProfileActivities()) {
      const day = localDate(new Date(activity.occurredAt)).slice(0, 10);
      const activities = activitiesByDay.get(day) ?? [];
      activities.push(activity);
      activitiesByDay.set(day, activities);
    }
    const months =
      this.profileMonth() === 'All'
        ? [...new Set([...activitiesByDay.keys()].map((day) => day.slice(0, 7)))].sort().reverse()
        : [this.profileMonth()];
    return months.map((month) => {
      const [year, monthNumber] = month.split('-').map(Number);
      const length = new Date(year, monthNumber, 0).getDate();
      return {
        month,
        offset: Array.from({ length: (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7 }),
        label: formatMonth(month),
        days: Array.from({ length }, (_, index) => {
          const date = new Date(year, monthNumber - 1, index + 1);
          const activities = activitiesByDay.get(localDate(date).slice(0, 10)) ?? [];
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
          return {
            date: dateLabel,
            count,
            summary: `${dateLabel}: ${count} ${count === 1 ? 'session' : 'sessions'}${
              count ? ` · ${sports.join(', ')} · ${format(minutes)} min` : ''
            }${distances.length ? ` · ${format(distances.reduce((sum, distance) => sum + distance, 0))} km recorded` : ''}`,
          };
        }),
      };
    });
  });

  activityForm = this.emptyActivity();
  eventForm = this.emptyEvent();
  clubForm = this.emptyClub();
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
      conferenceName: '',
      conferenceUrl: '',
      clubId: '',
    };
  }

  private emptyClub() {
    return { name: '', description: '', sport: '' as Sport | '' };
  }

  conferenceLink(value?: string | null): string | null {
    if (
      !value ||
      value.length > 2048 ||
      !/^https:\/\/[^/?#]+/i.test(value) ||
      /^https:\/\/[^/?#]*@/i.test(value) ||
      /[\s\\\u0000-\u001f\u007f]/.test(value)
    )
      return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname && !url.username && !url.password
        ? value
        : null;
    } catch {
      return null;
    }
  }

  private api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    return request<T>(path, method, data);
  }

  async load(): Promise<void> {
    try {
      const data = await this.api<Bootstrap>('/api/bootstrap');
      this.viewer.set(data.viewer);
      this.liveActivities.set(data.activities);
      this.liveEvents.set(data.events);
      this.clubs.set(data.clubs ?? []);
      this.githubConfigured.set(data.githubConfigured);
      this.atprotoConfigured.set(data.atprotoConfigured ?? false);
      this.preview.set(!data.viewer && data.activities.length === 0 && data.events.length === 0);
      if (this.page() === 'profile' && data.viewer && !this.remoteProfile()) {
        await this.loadOwnProfileActivities(this.routeRequest, data.viewer);
      }
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
    const [page, username] = (
      this.router.parseUrl(this.router.url).root.children['primary']?.segments ?? []
    ).map((segment) => segment.path);
    this.page.set(
      page === 'activities' && username
        ? 'activity'
        : this.nav.some((item) => item.page === page)
          ? (page as Page)
          : 'feed',
    );
    this.bulkVisibilityMode.set(false);
    this.selectedActivityIds.set([]);
    if (this.page() !== 'agents') this.newToken.set('');
    this.selectedSport.set('All');
    this.remoteProfile.set(null);
    this.socialCounts.set(null);
    this.remoteActivities.set([]);
    this.clubDetail.set(null);
    this.clubError.set('');
    this.clubLoading.set(false);
    this.ownProfileActivities.set([]);
    this.profileMonth.set('All');
    this.profileSport.set('All');
    this.profileError.set('');
    this.profileLoading.set(false);
    this.sharedActivity.set(null);
    this.sharedActivityError.set('');
    this.sharedActivityLoading.set(false);
    if (this.page() === 'activity') await this.loadSharedActivity(request, username);
    if (
      page === 'profile' &&
      username &&
      username !== this.viewer()?.username &&
      username !== this.viewer()?.id
    ) {
      this.profileLoading.set(true);
      try {
        const data = await this.api<{
          profile: Profile;
          activities: Activity[];
          social?: ProfileSocial;
        }>(`/api/profiles/${encodeURIComponent(username)}`);
        if (request === this.routeRequest) {
          this.remoteProfile.set(data.profile);
          this.socialCounts.set(data.social ?? null);
          this.remoteActivities.set(data.activities);
        }
      } catch (error) {
        if (request === this.routeRequest) this.profileError.set(this.message(error));
      } finally {
        if (request === this.routeRequest) this.profileLoading.set(false);
      }
    } else if (page === 'profile') {
      const viewer = this.viewer();
      if (viewer) await this.loadOwnProfileActivities(request, viewer);
    }
    if (page === 'agents' && this.viewer()) await this.loadTokens();
    if (page === 'clubs' && username) await this.loadClub(request, username);
    if (this.page() === 'feed' && this.feedMode() === 'following')
      await this.setFeedMode('following');
  }

  async setFeedMode(mode: 'community' | 'following' | 'mine'): Promise<void> {
    if (mode === 'following' && !this.signedIn()) return;
    this.feedMode.set(mode);
    if (mode !== 'following') return;
    const request = ++this.followingRequest;
    this.followingLoading.set(true);
    try {
      const data = await this.api<{ activities: Activity[] }>('/api/feed?scope=following');
      if (request === this.followingRequest) this.followingActivities.set(data.activities);
    } catch (error) {
      if (request === this.followingRequest) this.error.set(this.message(error));
    } finally {
      if (request === this.followingRequest) this.followingLoading.set(false);
    }
  }

  async toggleFollow(profile: Profile): Promise<void> {
    if (!this.signedIn()) return;
    if (this.participation() !== 'ok') {
      this.error.set('Make your profile public to follow people.');
      return;
    }
    const following = !!this.socialCounts()?.viewerFollows;
    await this.action(async () => {
      const social = await this.api<ProfileSocial>('/api/follows', 'POST', {
        userId: profile.id,
        follow: !following,
      });
      if (this.remoteProfile()?.id === profile.id) this.socialCounts.set(social);
      this.notice.set(
        following ? `You unfollowed ${profile.name}.` : `You are following ${profile.name}.`,
      );
    });
  }

  private async loadSharedActivity(request: number, id: string): Promise<void> {
    this.sharedActivityLoading.set(true);
    try {
      const data = await this.api<{ activity: Activity }>(
        `/api/activities/${encodeURIComponent(id)}`,
      );
      if (request === this.routeRequest) this.sharedActivity.set(data.activity);
    } catch (error) {
      if (request === this.routeRequest) this.sharedActivityError.set(this.message(error));
    } finally {
      if (request === this.routeRequest) this.sharedActivityLoading.set(false);
    }
  }

  private async loadClub(request: number, slug: string): Promise<void> {
    this.clubLoading.set(true);
    this.clubError.set('');
    try {
      const data = await this.api<ClubDetail>(`/api/clubs/${encodeURIComponent(slug)}`);
      if (request === this.routeRequest) this.clubDetail.set(data);
    } catch (error) {
      if (request === this.routeRequest) this.clubError.set(this.message(error));
    } finally {
      if (request === this.routeRequest) this.clubLoading.set(false);
    }
  }

  private async refreshClub(): Promise<void> {
    const slug = this.clubDetail()?.club.slug;
    if (slug) await this.loadClub(this.routeRequest, slug);
  }

  async toggleMembership(club: Club): Promise<void> {
    if (!this.signedIn()) return;
    if (!club.joined && this.participation() !== 'ok') {
      this.error.set('Make your profile public to join clubs.');
      return;
    }
    await this.action(async () => {
      await this.api(`/api/clubs/${encodeURIComponent(club.slug)}/membership`, 'POST', {
        join: !club.joined,
      });
      await this.load();
      await this.refreshClub();
      this.notice.set(club.joined ? `You left ${club.name}.` : `Welcome to ${club.name}!`);
    });
  }

  async deleteClub(club: Club): Promise<void> {
    if (!window.confirm(`Delete "${club.name}"? Its events stay public without the club label.`))
      return;
    await this.action(async () => {
      await this.api(`/api/clubs/${encodeURIComponent(club.slug)}`, 'DELETE');
      await this.load();
      this.notice.set('Club deleted.');
      this.navigate('clubs');
    });
  }

  /** Clubs an event can be linked to: joined clubs plus the event's current club. */
  eventClubOptions(): Club[] {
    return this.clubs().filter((club) => club.joined || club.id === this.eventForm.clubId);
  }

  private async loadOwnProfileActivities(request: number, viewer: Profile): Promise<void> {
    this.profileLoading.set(true);
    this.profileError.set('');
    try {
      const identifier = viewer.provider === 'atproto' ? viewer.id : viewer.username;
      const data = await this.api<{ activities: Activity[]; social?: ProfileSocial }>(
        `/api/profiles/${encodeURIComponent(identifier)}`,
      );
      if (request === this.routeRequest) {
        this.ownProfileActivities.set(data.activities);
        this.socialCounts.set(data.social ?? null);
      }
    } catch (error) {
      if (request === this.routeRequest) this.profileError.set(this.message(error));
    } finally {
      if (request === this.routeRequest) this.profileLoading.set(false);
    }
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

  loginAtproto(): void {
    if (!this.atprotoConfigured()) {
      this.error.set(
        'AT Protocol sign-in needs setup: add the OAuth signing and session encryption keys to the Worker. See README.md.',
      );
      return;
    }
    this.error.set('');
    this.notice.set('');
    this.atprotoHandle = '';
    this.modal.set('atproto-login');
    this.dialog()?.nativeElement.showModal();
  }

  beginAtprotoLogin(): void {
    const handle = this.atprotoHandle.trim();
    if (!handle || handle.length > 253) {
      this.error.set('Enter a valid AT Protocol handle or DID.');
      return;
    }
    window.location.assign(`/auth/atproto?${new URLSearchParams({ handle })}`);
  }

  private signedIn(): boolean {
    if (this.viewer()) return true;
    this.notice.set(
      'Your story starts here. Sign in with GitHub or AT Protocol to log an activity, join an event, or connect an agent.',
    );
    return false;
  }

  openModal(modal: Exclude<Modal, null>): void {
    if (!this.signedIn()) return;
    this.error.set('');
    this.notice.set('');
    this.publicDisclosure.set(false);
    if (modal === 'activity') {
      this.activityForm = this.emptyActivity();
      if (this.viewer()?.provider === 'atproto') this.activityForm.visibility = 'public';
      this.removePhoto();
    }
    if (modal === 'event') {
      this.eventForm = this.emptyEvent();
      this.editingEvent.set(null);
      this.editingClubId = null;
      const club = this.clubDetail()?.club;
      if (this.page() === 'clubs' && club?.joined) this.eventForm.clubId = club.id;
    }
    if (modal === 'club') {
      if (this.participation() !== 'ok') {
        this.error.set('Make your profile public to create a club.');
        return;
      }
      this.clubForm = this.emptyClub();
    }
    if (modal === 'profile') {
      const user = this.viewer()!;
      this.profileForm = {
        name: user.name,
        bio: user.bio,
        location: user.location,
        visibility: user.provider === 'atproto' ? 'public' : user.visibility,
        sports: [...user.sports],
      };
    }
    this.modal.set(modal);
    this.dialog()?.nativeElement.showModal();
  }

  makeProfilePublic(): void {
    this.openModal('profile');
    if (this.modal() === 'profile') this.profileForm.visibility = 'public';
  }

  async copyProfileLink(profile: Profile): Promise<void> {
    if (profile.visibility !== 'public') return;
    const identifier = profile.provider === 'atproto' ? profile.id : profile.username;
    const url = new URL(`/profile/${encodeURIComponent(identifier)}`, window.location.origin).href;
    this.error.set('');
    try {
      await navigator.clipboard.writeText(url);
      this.notice.set('Profile link copied.');
    } catch {
      this.notice.set('');
      this.error.set(`Could not copy the profile link. Copy it manually: ${url}`);
    }
  }

  async shareClub(club: Club): Promise<void> {
    const url = new URL(`/clubs/${encodeURIComponent(club.slug)}`, window.location.origin).href;
    this.error.set('');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: club.name,
          text: `Join ${club.name} on Devs Who Move`,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      this.notice.set('Club invite link copied. Share it so people can join.');
    } catch {
      this.notice.set('');
      this.error.set(`Could not copy the club link. Copy it manually: ${url}`);
    }
  }

  closeModal(): void {
    if (this.saving()) return;
    this.dialog()?.nativeElement.close();
    this.modal.set(null);
    this.removePhoto();
  }

  async choosePhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set('');
    this.photoBusy.set(true);
    try {
      const photo = await this.preparePhoto(file);
      this.removePhoto();
      this.photo.set(photo);
      this.photoPreview.set(URL.createObjectURL(photo));
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.photoBusy.set(false);
    }
  }

  removePhoto(): void {
    if (this.photoPreview()) URL.revokeObjectURL(this.photoPreview());
    this.photo.set(null);
    this.photoPreview.set('');
  }

  private async uploadPhoto(activityId: string, photo: Blob): Promise<void> {
    const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/photo`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': photo.type || 'image/jpeg' },
      body: photo,
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(result.error || 'The photo upload failed.');
    }
  }

  toggleSport(sport: Sport): void {
    this.profileForm.sports = this.profileForm.sports.includes(sport)
      ? this.profileForm.sports.filter((item) => item !== sport)
      : [...this.profileForm.sports, sport];
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    if (
      this.viewer()?.provider === 'atproto' &&
      this.modal() !== 'club' &&
      !this.publicDisclosure()
    ) {
      this.error.set('Confirm that this will be publicly visible before saving.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    try {
      if (this.modal() === 'activity') {
        const { id } = await this.api<{ id: string }>('/api/activities', 'POST', {
          ...this.activityForm,
          occurredAt: new Date(this.activityForm.occurredAt).toISOString(),
        });
        const photo = this.photo();
        let photoError = '';
        if (photo) {
          try {
            await this.uploadPhoto(id, photo);
          } catch (error) {
            photoError = this.message(error);
          }
        }
        this.notice.set(
          photoError
            ? `Activity logged, but the photo didn’t upload: ${photoError}`
            : 'Activity logged. Every little move counts.',
        );
      } else if (this.modal() === 'event') {
        const conferenceName = this.eventForm.conferenceName.trim();
        const conferenceUrl = this.eventForm.conferenceUrl.trim();
        if (conferenceName.length > 100)
          throw new Error('Conference name must be at most 100 characters.');
        if (conferenceUrl && !conferenceName)
          throw new Error('Add a conference name for the conference URL.');
        if (conferenceUrl && !this.conferenceLink(conferenceUrl))
          throw new Error('Conference URL must be a safe HTTPS URL without credentials.');
        const editing = this.editingEvent();
        const { clubId, ...event } = this.eventForm;
        await this.api(
          editing ? `/api/events/${encodeURIComponent(editing)}` : '/api/events',
          editing ? 'PATCH' : 'POST',
          {
            ...event,
            ...(!editing || (clubId || null) !== this.editingClubId
              ? { clubId: clubId || null }
              : {}),
            conferenceName: conferenceName || null,
            conferenceUrl: conferenceUrl || null,
            startsAt: new Date(this.eventForm.startsAt).toISOString(),
          },
        );
        this.notice.set(
          editing
            ? 'Event updated. Everyone going will see the latest details.'
            : 'Event created. You are on the list as host.',
        );
        if (this.page() !== 'clubs') this.navigate('events');
      } else if (this.modal() === 'club') {
        const { club } = await this.api<{ club: Club }>('/api/clubs', 'POST', {
          ...this.clubForm,
          sport: this.clubForm.sport || null,
        });
        this.notice.set(`${club.name} is ready. Invite your people.`);
        void this.router.navigateByUrl(`/clubs/${encodeURIComponent(club.slug)}`);
      } else {
        await this.api('/api/me', 'PATCH', this.profileForm);
        this.notice.set('Profile updated. Your privacy, your call.');
      }
      await this.load();
      await this.refreshClub();
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
      await this.api(`/api/events/${encodeURIComponent(event.id)}/join`, 'POST', {
        join: !event.joined,
      });
      this.notice.set(
        event.joined
          ? 'You have left the event.'
          : 'You are in! The event is now in your upcoming sessions.',
      );
      await this.load();
      await this.refreshClub();
    });
  }

  async toggleAttendees(event: SportEvent): Promise<void> {
    const request = ++this.attendeeRequest;
    if (this.attendeeEvent() === event.id) {
      this.attendeeEvent.set(null);
      this.loadingAttendees.set(null);
      return;
    }
    this.attendeeEvent.set(event.id);
    this.eventAttendees.set([]);
    this.loadingAttendees.set(event.id);
    this.error.set('');
    try {
      const result = await this.api<{ attendees: EventAttendee[] }>(
        `/api/events/${encodeURIComponent(event.id)}/attendees`,
      );
      if (request === this.attendeeRequest) this.eventAttendees.set(result.attendees);
    } catch (error) {
      if (request === this.attendeeRequest) {
        this.error.set(this.message(error));
        this.attendeeEvent.set(null);
      }
    } finally {
      if (request === this.attendeeRequest) this.loadingAttendees.set(null);
    }
  }

  editEvent(event: SportEvent): void {
    this.openModal('event');
    if (this.modal() !== 'event') return;
    this.editingEvent.set(event.id);
    this.eventForm = {
      title: event.title,
      sport: event.sport,
      startsAt: localDate(new Date(event.startsAt)),
      location: event.location,
      description: event.description,
      level: event.level,
      capacity: event.capacity,
      conferenceName: event.conferenceName ?? '',
      conferenceUrl: event.conferenceUrl ?? '',
      clubId: event.clubId ?? '',
    };
    this.editingClubId = event.clubId ?? null;
  }

  async cancelEvent(event: SportEvent): Promise<void> {
    if (!window.confirm(`Cancel "${event.title}" for everyone?`)) return;
    await this.action(async () => {
      await this.api(`/api/events/${encodeURIComponent(event.id)}`, 'POST', {});
      await this.load();
      this.notice.set('Event cancelled. It is no longer available to join.');
    });
  }

  async toggleVisibility(activity: Activity): Promise<void> {
    const next = activity.visibility === 'public' ? 'private' : 'public';
    if (
      next === 'public' &&
      !window.confirm(
        this.profileHidden()
          ? 'Make this activity public? Your profile is private, so it stays hidden until you make your profile public.'
          : 'Make this activity public? It will appear in the community feed.',
      )
    )
      return;
    await this.action(async () => {
      await this.api(`/api/activities/${encodeURIComponent(activity.id)}`, 'PATCH', {
        visibility: next,
      });
      await this.load();
      this.notice.set(
        next === 'public' && this.profileHidden()
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
      this.filteredProfileActivities()
        .slice(0, 100)
        .map((activity) => activity.id),
    );
  }

  clearActivitySelection(): void {
    this.selectedActivityIds.set([]);
  }

  async setSelectedVisibility(next: Visibility): Promise<void> {
    const ids = this.profileActivities()
      .filter((activity) => this.selectedActivityIds().includes(activity.id))
      .map((activity) => activity.id);
    if (!ids.length || this.saving()) return;
    if (
      next === 'public' &&
      !window.confirm(
        `Make ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'} public? ${
          this.profileHidden()
            ? 'Your profile is private, so they stay hidden until you make your profile public.'
            : 'They will appear in the community feed.'
        }`,
      )
    )
      return;
    await this.action(async () => {
      await this.api('/api/activities/bulk-visibility', 'PATCH', { ids, visibility: next });
      await this.load();
      this.selectedActivityIds.set([]);
      this.bulkVisibilityMode.set(false);
      this.notice.set(
        `${ids.length} ${ids.length === 1 ? 'activity is' : 'activities are'} now ${next}.${
          next === 'public' && this.profileHidden()
            ? ' Make your profile public to share them.'
            : ''
        }`,
      );
    });
  }

  async deleteActivity(activity: Activity): Promise<void> {
    if (!window.confirm(`Delete "${activity.title}"? This cannot be undone.`)) return;
    await this.action(async () => {
      await this.api(`/api/activities/${encodeURIComponent(activity.id)}`, 'DELETE');
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
      this.feedMode.set('community');
      this.followingRequest++;
      this.followingActivities.set([]);
      this.followingLoading.set(false);
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
    return errorMessage(error);
  }
}
