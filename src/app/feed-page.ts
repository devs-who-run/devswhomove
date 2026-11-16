import { Component, input, output } from '@angular/core';
import { ActivityCard } from './activity-card';
import type { Participation } from './activity-social';
import { FeedSidebar } from './feed-sidebar';
import { Icon } from './icon';
import type { Activity, Profile, Sport, SportEvent } from './models';
import { SportFilter } from './sport-filter';

export type FeedMode = 'community' | 'following' | 'mine';

@Component({
  selector: 'app-feed-page',
  imports: [ActivityCard, FeedSidebar, Icon, SportFilter],
  templateUrl: './feed-page.html',
  styleUrls: ['./page-layout.css', './privacy-callout.css', './feed-hero.css', './feed-page.css'],
})
export class FeedPage {
  readonly viewer = input<Profile | null>(null);
  readonly preview = input(false);
  readonly saving = input(false);
  readonly profileHidden = input(false);
  readonly participation = input<Participation>('anonymous');
  readonly feedMode = input<FeedMode>('community');
  readonly followingLoading = input(false);
  readonly selectedSport = input<Sport | 'All'>('All');
  readonly activities = input.required<Activity[]>();
  readonly myActivities = input.required<Activity[]>();
  readonly events = input.required<SportEvent[]>();
  readonly feedModeChange = output<FeedMode>();
  readonly selectedSportChange = output<Sport | 'All'>();
  readonly visibilityChange = output<Activity>();
  readonly navigate = output<'events' | 'agents'>();
  readonly logActivity = output<void>();
  readonly hostEvent = output<void>();
  readonly makeProfilePublic = output<void>();
}
