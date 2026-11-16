import { DecimalPipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { Icon } from './icon';
import type { Profile, ProfileSocial } from './models';

@Component({
  selector: 'app-profile-header',
  imports: [DecimalPipe, Icon],
  templateUrl: './profile-header.html',
  styleUrls: ['./page-layout.css', './privacy-callout.css', './profile-header.css'],
})
export class ProfileHeader {
  readonly profileData = input.required<Profile>();
  readonly viewer = input<Profile | null>(null);
  readonly remote = input(false);
  readonly social = input<ProfileSocial | null>(null);
  readonly saving = input(false);
  readonly stats = input.required<{
    sessions: number;
    distance: number;
    hours: number;
    sports: number;
  }>();
  readonly edit = output<void>();
  readonly follow = output<Profile>();
  readonly copyLink = output<Profile>();
  readonly makePublic = output<void>();

  initials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
}
