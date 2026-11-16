import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivityCard } from './activity-card';
import { ActivityCalendar } from './activity-calendar';
import type { Participation } from './activity-social';
import { errorMessage, request } from './api';
import { Icon } from './icon';
import { DEMO_ACTIVITIES, DEMO_EVENTS } from './demo';
import { ProfileBadges } from './badges';
import { DeveloperInsights } from './developer-insights';
import { FeedPage } from './feed-page';
import { FeedState } from './feed-state';
import { Login } from './login';
import { AgentPage } from './agent-page';
import { AgentTokens } from './agent-tokens';
import { EventsPage } from './events-page';
import { AppDialog } from './app-dialog';
import { DialogState } from './dialog-state';
import { ClubsPage } from './clubs-page';
import { ActivityActions } from './activity-actions';
import { EventActions } from './event-actions';
import { ClubActions } from './club-actions';
import { ProfileActivities } from './profile-activities';
import { ProfileHeader } from './profile-header';
import { AppSidebar, type Page } from './app-sidebar';
import { AppTopbar } from './app-topbar';
import { AuthState } from './auth-state';
import { ProfileSummary } from './profile-summary';
import {
  type Activity,
  type Bootstrap,
  type Club,
  type Profile,
  type ProfileSocial,
  type Sport,
  type SportEvent,
} from './models';

@Component({
  imports: [
    ActivityCard,
    ActivityCalendar,
    FormsModule,
    Icon,
    RouterLink,
    RouterOutlet,
    DeveloperInsights,
    FeedPage,
    Login,
    AgentPage,
    EventsPage,
    AppDialog,
    ClubsPage,
    ProfileActivities,
    ProfileHeader,
    AppSidebar,
    AppTopbar,
    ProfileBadges,
  ],
  selector: 'app-root',
  styleUrls: ['./page-layout.css', './app.css'],
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
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
  readonly preview = signal(false);
  readonly selectedSport = signal<Sport | 'All'>('All');
  readonly clubs = signal<Club[]>([]);
  readonly socialCounts = signal<ProfileSocial | null>(null);
  readonly remoteProfile = signal<Profile | null>(null);
  readonly remoteActivities = signal<Activity[]>([]);
  readonly ownProfileActivities = signal<Activity[]>([]);
  readonly profileMonth = signal('All');
  readonly profileSport = signal<Sport | 'All'>('All');
  readonly heatmapYear = signal('last-12-months');
  readonly profileLoading = signal(false);
  readonly profileError = signal('');
  readonly sharedActivity = signal<Activity | null>(null);
  readonly sharedActivityLoading = signal(false);
  readonly sharedActivityError = signal('');
  private readonly dialog = viewChild(AppDialog);
  private routeRequest = 0;

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
  readonly filteredEvents = computed(() =>
    this.events().filter(
      (event) => this.selectedSport() === 'All' || event.sport === this.selectedSport(),
    ),
  );
  readonly profileSummary = new ProfileSummary({
    activities: () => this.profileActivities(),
    sport: () => this.profileSport(),
    month: () => this.profileMonth(),
  });
  readonly feed = new FeedState({
    activities: () => this.activities(),
    viewer: () => this.viewer(),
    selectedSport: () => this.selectedSport(),
    signedIn: () => this.auth.signedIn(),
    error: this.error,
  });
  readonly agent = new AgentTokens({
    action: (work) => this.action(work),
    signedIn: () => this.auth.signedIn(),
    error: this.error,
    notice: this.notice,
  });
  readonly activityActions = new ActivityActions({
    activities: () => this.profileActivities(),
    filteredActivities: () => this.profileSummary.filteredActivities(),
    profileHidden: () => this.profileHidden(),
    saving: () => this.saving(),
    action: (work) => this.action(work),
    load: () => this.load(),
    notice: this.notice,
  });
  readonly eventActions = new EventActions({
    signedIn: () => this.auth.signedIn(),
    action: (work) => this.action(work),
    load: () => this.load(),
    refreshClub: () => this.clubActions.refresh(),
    error: this.error,
    notice: this.notice,
  });
  readonly clubActions = new ClubActions({
    routeRequest: () => this.routeRequest,
    signedIn: () => this.auth.signedIn(),
    participation: () => this.participation(),
    action: (work) => this.action(work),
    load: () => this.load(),
    navigateToClubs: () => this.navigate('clubs'),
    error: this.error,
    notice: this.notice,
  });

  readonly editor = new DialogState({
    viewer: () => this.viewer(),
    page: () => this.page(),
    clubs: () => this.clubs(),
    clubDetail: () => this.clubActions.detail(),
    participation: () => this.participation(),
    signedIn: () => this.auth.signedIn(),
    saving: this.saving,
    error: this.error,
    notice: this.notice,
    show: () => this.dialog()?.show(),
    close: () => this.dialog()?.close(),
    load: () => this.load(),
    refreshClub: () => this.clubActions.refresh(),
    navigateEvents: () => this.navigate('events'),
    navigateToClub: (slug) => {
      void this.router.navigateByUrl(`/clubs/${encodeURIComponent(slug)}`);
    },
  });

  readonly auth = new AuthState({
    viewer: () => this.viewer(),
    error: this.error,
    notice: this.notice,
    openAtprotoLogin: () => this.editor.openAtprotoLogin(),
    action: (work) => this.action(work),
    clearSession: () => {
      this.agent.clear();
      this.remoteProfile.set(null);
      this.feed.clear();
    },
    load: () => this.load(),
    navigateToFeed: () => this.navigate('feed'),
  });

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd && !this.loading()) void this.route();
    });
    void this.load().then(() => this.route());
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
      this.auth.githubConfigured.set(data.githubConfigured);
      this.auth.atprotoConfigured.set(data.atprotoConfigured ?? false);
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
    this.activityActions.reset();
    if (this.page() !== 'agents') this.agent.newToken.set('');
    this.selectedSport.set('All');
    this.remoteProfile.set(null);
    this.socialCounts.set(null);
    this.remoteActivities.set([]);
    this.clubActions.reset();
    this.ownProfileActivities.set([]);
    this.profileMonth.set('All');
    this.profileSport.set('All');
    this.heatmapYear.set('last-12-months');
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
    if (page === 'agents' && this.viewer()) await this.agent.load();
    if (page === 'clubs' && username) await this.clubActions.load(request, username);
    if (this.page() === 'feed' && this.feed.mode() === 'following')
      await this.feed.setMode('following');
  }

  async toggleFollow(profile: Profile): Promise<void> {
    if (!this.auth.signedIn()) return;
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

  pace(activity: Activity): string {
    if (!activity.distance) return '';
    const seconds = Math.round((activity.duration * 60) / activity.distance);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  private message(error: unknown): string {
    return errorMessage(error);
  }
}
