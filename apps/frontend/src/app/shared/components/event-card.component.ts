import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SvgIconDirective } from '../directives/svg/svg-icon';
import { ICON_NAME } from '../directives/svg';


export interface Event {
  id: string;
  conference: string;
  eventType: string;
  date: string;
  location: string;
  name: string;
  sport: string;
  description: string;
  time: string;
  capacity: number;
  createdAt: Date;
  updatedAt: Date;
}

@Component({
  selector: 'app-event-card',
  standalone: true,
  imports: [DatePipe, SvgIconDirective],
  template: `
    <div
      class="glass-card p-4 sm:p-6 w-full max-w-md mx-auto lg:max-w-none"
    >
      <div
        class="responsive-flex mb-4"
      >
        <div class="flex items-center space-x-3 min-w-0 flex-1">
          <div
            class="icon-container"
          >
            <span
              appSvgIcon
              [iconName]="iconName.conference"
              [iconClass]="'w-4 h-4 sm:w-5 sm:h-5 text-white'"
            ></span>

          </div>
          <div class="min-w-0 flex-1">
            <h3
              class="card-title"
            >
              {{ event().conference }}
            </h3>
          </div>
        </div>
        <span
          class="event-badge"
          [class]="getEventTypeClass(event().eventType)"
        >
          {{ event().eventType }}
        </span>
      </div>

      <div class="space-y-4">
        <div class="responsive-grid">
          <div class="field-container">
            <div class="field-content">
              <p class="field-label">Sport</p>
              <p class="field-value-truncate">{{ event().sport }}</p>
            </div>
          </div>

          <div class="field-container">
            <div class="field-content">
              <p class="field-label">Location</p>
              <p class="field-value-truncate">{{ event().location }}</p>
            </div>
          </div>
        </div>

        <div class="responsive-grid">
          <div class="field-container">
            <div class="field-content">
              <p class="field-label">Date</p>
              <p class="field-value">{{ event().date | date : 'mediumDate' }}</p>
            </div>
          </div>

          <div class="field-container">
            <div class="field-content">
              <p class="field-label">Time</p>
              <p class="field-value">{{ event().time }}</p>
            </div>
          </div>
        </div>

        <div class="field-container">
          <div class="flex-1">
            <p class="field-label">Description</p>
            <p class="description-text">{{ event().description }}</p>
          </div>
        </div>

        <div class="field-container">
          <div class="flex-1">
            <p class="field-label">Capacity</p>
            <div class="mt-1 flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
              <span class="field-value flex-shrink-0">{{ event().capacity }} people</span>
            </div>
          </div>
        </div>
      </div>

      <div
        class="mt-4 sm:mt-6 pt-4 border-t border-gray-200 dark:border-gray-700"
      >
        <div
          class="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0"
        >
          <p
            class="text-xs text-gray-500 dark:text-gray-400 order-2 sm:order-1"
          >
            Created {{ event().createdAt | date : 'short' }}
          </p>
          <button
            class="primary-btn"
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  `,
})
export class EventCardComponent {
  event = input.required<Event>();
  iconName = ICON_NAME;

  getEventTypeClass(eventType: string): string {
    const baseClasses = 'text-white';
    switch (eventType.toLowerCase()) {
      case 'workshop':
        return `${baseClasses} bg-gradient-to-r from-green-500 to-emerald-600`;
      case 'conference':
        return `${baseClasses} bg-gradient-to-r from-purple-500 to-pink-600`;
      case 'meetup':
        return `${baseClasses} bg-gradient-to-r from-orange-500 to-red-600`;
      default:
        return `${baseClasses} bg-gradient-to-r from-gray-500 to-gray-600`;
    }
  }
}
