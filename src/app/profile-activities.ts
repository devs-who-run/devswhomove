import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { ActivityActions } from './activity-actions';
import { Icon } from './icon';
import type { Activity, Profile } from './models';

@Component({
  selector: 'app-profile-activities',
  imports: [DatePipe, Icon],
  templateUrl: './profile-activities.html',
  styleUrls: ['./page-layout.css', './profile-activities.css'],
})
export class ProfileActivities {
  readonly actions = input.required<ActivityActions>();
  readonly activities = input.required<Activity[]>();
  readonly totalActivities = input.required<Activity[]>();
  readonly profile = input.required<Profile>();
  readonly viewer = input<Profile | null>(null);
  readonly remote = input(false);
  readonly saving = input(false);
  readonly logActivity = output<void>();
}
