import { Component, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EventApiService } from '../../shared/services/event-api';
import { EventCardComponent } from '../../shared/components/event-card.component';
import { EventCardSkeletonComponent } from '../../shared/components/event-card-skeleton.component';

@Component({
  selector: 'app-dashboard',
  imports: [EventCardComponent, EventCardSkeletonComponent, RouterLink],
  template: `
    <main class="page-container">
      <div class="flex items-center justify-between mb-12">
        <h1
          class="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400"
        >
          Welcome to DevsWhoRun! 🏃‍♂️
        </h1>
        <a
          routerLink="/event/create"
          class="primary-btn cursor-pointer whitespace-nowrap"
        >
          + Create Event
        </a>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        @if (events.isLoading()) { @for (i of skeletonItems; track i) {
        <app-event-card-skeleton />
        } } @else if (events.error()) {
        <div class="col-span-full text-center text-red-500">
          Error loading events
        </div>
        } @else { @for (event of events.value(); track event.id) {
        <app-event-card [event]="event" />
        } }
      </div>
    </main>
  `,
})
export class DashboardComponent {
  readonly skeletonItems = Array.from({ length: 6 }, (_, i) => i);
  private readonly eventApiService = inject(EventApiService);
  events = rxResource({
    stream: () => this.eventApiService.getEvents(),
    defaultValue: [],
  });
}
