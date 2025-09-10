import { Component, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { EventApiService } from '../../shared/services/event-api';
import { EventCardComponent } from '../../shared/components/event-card.component';

@Component({
  selector: 'app-dashboard',
  imports: [EventCardComponent],
  template: `
    <main class="page-container">
      <div class="text-center mb-12">
        <h1
          class="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 mb-4"
        >
          Welcome to DevsWhoRun! 🏃‍♂️
        </h1>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        @if(events.isLoading()) {
        <!-- We can replace this with skeleton loader -->
        <div>Loading...</div>
        } @else if(events.error()) {
        <div>Error loading events</div>
        } @else { @for(event of events.value(); track event.id) {
        <app-event-card [event]="event" />
        } }
      </div>
    </main>
  `,
})
export class DashboardComponent {
  private readonly eventApiService = inject(EventApiService);
  events = rxResource({
    loader: () => this.eventApiService.getEvents(),
    defaultValue: [],
  });
}
