import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';
import type { Activity } from './models';

@Component({
  imports: [DatePipe, DecimalPipe, Icon, RouterLink],
  selector: 'app-activity-card',
  styleUrl: './activity-card.css',
  template: `
    <article class="activity-card">
      <div class="activity-header">
        <a
          class="person"
          [routerLink]="
            activity().userId === viewerId()
              ? ['/profile']
              : [
                  '/profile',
                  activity().userId.startsWith('did:') ? activity().userId : activity().username,
                ]
          "
          ><span
            class="avatar"
            [class.orange]="activity().sport === 'Cycling'"
            [class.lilac]="activity().sport === 'Tennis'"
          >
            @if (activity().avatar) {
              <img [src]="activity().avatar" alt="" loading="lazy" referrerpolicy="no-referrer" />
            } @else {
              {{ initials(activity().name) }}
            }</span
          ><span
            ><strong>{{ activity().name }}</strong
            ><small
              >&#64;{{ activity().username }} <span aria-hidden="true">·</span>
              {{ activity().occurredAt | date: 'MMM d, h:mm a' }}</small
            ></span
          ></a
        >
        <span class="sport-label"
          ><app-icon [name]="activity().sport" />{{ activity().sport }}</span
        >
      </div>
      <h3>{{ activity().title }}</h3>
      <p class="activity-notes">{{ activity().notes }}</p>
      @if (activity().photo) {
        <img
          class="activity-photo"
          [src]="activity().photo"
          [alt]="'Photo from ' + activity().title"
          loading="lazy"
        />
      }
      <div class="activity-metrics">
        @if (activity().sport === 'Walking' && activity().steps != null) {
          <div>
            <span>Steps</span
            ><strong>{{ activity().steps | number }} <small>steps</small></strong>
          </div>
        } @else if (activity().distance !== null) {
          <div>
            <span>Distance</span
            ><strong>{{ activity().distance | number: '1.0-2' }} <small>km</small></strong>
          </div>
        }
        <div>
          <span>Moving time</span
          ><strong>{{ activity().duration | number: '1.0-1' }} <small>min</small></strong>
        </div>
        @if (activity().sport === 'Running' && activity().distance) {
          <div>
            <span>Avg. pace</span><strong>{{ pace(activity()) }} <small>/km</small></strong>
          </div>
        }
        @if (activity().sport === 'Cycling' && activity().distance) {
          <div>
            <span>Avg. speed</span
            ><strong
              >{{ ((activity().distance ?? 0) / activity().duration) * 60 | number: '1.0-1' }}
              <small>km/h</small></strong
            >
          </div>
        }
        <span class="activity-glyph" aria-hidden="true"
          ><app-icon [name]="activity().sport"
        /></span>
      </div>
      <footer class="activity-footer">
        @if (
          activity().visibility === 'public' && activity().userId === viewerId() && profileHidden()
        ) {
          <span title="Make your profile public to share this activity."
            ><app-icon name="lock" />Public · hidden while your profile is private</span
          >
        } @else {
          <span
            ><app-icon [name]="activity().visibility === 'private' ? 'lock' : 'globe'" />{{
              activity().visibility === 'private' ? 'Only you' : 'Public activity'
            }}</span
          >
        }
        @if (activity().source === 'agent') {
          <span class="agent-label"><app-icon name="terminal" /> Logged by an agent</span>
        }
        @if (canChangeVisibility() && activity().userId === viewerId()) {
          <button
            class="text-button"
            (click)="visibilityChange.emit(activity())"
            [disabled]="saving()"
          >
            Make {{ activity().visibility === 'public' ? 'private' : 'public' }}
          </button>
        }
      </footer>
    </article>
  `,
})
export class ActivityCard {
  readonly activity = input.required<Activity>();
  readonly viewerId = input<string | null>(null);
  readonly profileHidden = input(false);
  readonly canChangeVisibility = input(false);
  readonly saving = input(false);
  readonly visibilityChange = output<Activity>();

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
}
