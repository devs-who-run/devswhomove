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
      <div
        class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6 mb-6 sm:mb-8 md:mb-12"
      >
        <div class="flex gap-2">
          <h1
            class="text-2xl mx-auto sm:m-0 sm:text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400"
          >
            Welcome to DevsWhoRun!
          </h1>
          <span class="text-3xl">🏃‍♂️</span>
        </div>
        <a
          routerLink="/create-event"
          class="w-full sm:w-auto primary-btn cursor-pointer whitespace-nowrap text-center"
        >
          + Create Event
        </a>
      </div>
      <div
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
      >
        @if (events.isLoading()) { @for (i of skeletonItems; track i) {
        <app-event-card-skeleton />
        } } @else if (events.error()) {
        <div
          class="col-span-full text-center text-sm sm:text-base text-red-500 py-8"
        >
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
