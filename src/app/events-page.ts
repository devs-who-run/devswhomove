import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { conferenceLink } from './conference-link';
import { Icon } from './icon';
import type { EventAttendee, Profile, Sport, SportEvent } from './models';
import { SportFilter } from './sport-filter';

@Component({
  selector: 'app-events-page',
  imports: [DatePipe, Icon, RouterLink, SportFilter],
  templateUrl: './events-page.html',
  styleUrls: [
    './page-layout.css',
    './listing-cards.css',
    './events-page.css',
    './events-page-card.css',
  ],
})
export class EventsPage {
  readonly events = input.required<SportEvent[]>();
  readonly viewer = input<Profile | null>(null);
  readonly selectedSport = input<Sport | 'All'>('All');
  readonly saving = input(false);
  readonly attendeeEvent = input<string | null>(null);
  readonly loadingAttendees = input<string | null>(null);
  readonly eventAttendees = input<EventAttendee[]>([]);

  readonly selectedSportChange = output<Sport | 'All'>();
  readonly hostEvent = output<void>();
  readonly toggleAttendees = output<SportEvent>();
  readonly editEvent = output<SportEvent>();
  readonly cancelEvent = output<SportEvent>();
  readonly joinEvent = output<SportEvent>();
  readonly conferenceLink = conferenceLink;

  capacityPercent(event: SportEvent): number {
    return event.capacity > 0 ? Math.min(100, (event.attendees / event.capacity) * 100) : 0;
  }
}
