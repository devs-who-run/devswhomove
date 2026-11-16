import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivityCard } from './activity-card';
import type { Participation } from './activity-social';
import { Icon } from './icon';
import type { Club, ClubDetail, Profile, SportEvent } from './models';

@Component({
  selector: 'app-clubs-page',
  imports: [ActivityCard, DatePipe, Icon, RouterLink],
  templateUrl: './clubs-page.html',
  styleUrls: [
    './page-layout.css',
    './listing-cards.css',
    './privacy-callout.css',
    './clubs-page.css',
  ],
})
export class ClubsPage {
  readonly loading = input(false);
  readonly error = input('');
  readonly detail = input<ClubDetail | null>(null);
  readonly clubs = input<Club[]>([]);
  readonly viewer = input<Profile | null>(null);
  readonly profileHidden = input(false);
  readonly participation = input<Participation>('anonymous');
  readonly saving = input(false);
  readonly shareClub = output<Club>();
  readonly deleteClub = output<Club>();
  readonly toggleMembership = output<Club>();
  readonly hostEvent = output<void>();
  readonly joinEvent = output<SportEvent>();
  readonly startClub = output<void>();
  readonly makeProfilePublic = output<void>();
}
