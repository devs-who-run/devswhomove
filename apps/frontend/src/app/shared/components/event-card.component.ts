import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
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
  imports: [DatePipe, SvgIconDirective, RouterLink],
  template: `
    <div class="glass-card p-3 sm:p-4 md:p-6 w-full">
      <div
        class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3 sm:mb-4"
      >
        <div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div
            class="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center"
          >
            <span
              appSvgIcon
              [iconName]="iconName.conference"
              [iconClass]="'w-4 h-4 sm:w-5 sm:h-5 text-white'"
            ></span>
          </div>
          <div class="min-w-0 flex-1">
            <h3
              class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate"
            >
              {{ event().conference }}
            </h3>
          </div>
        </div>
        <span
          class="inline-flex items-center px-2.5 py-1 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap self-start"
          [class]="getEventTypeClass(event().eventType)"
        >
          {{ event().eventType }}
        </span>
      </div>

      <div class="space-y-3 sm:space-y-4">
        <div class="grid grid-cols-2 gap-3 sm:gap-4">
          <div>
            <p
              class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1"
            >
              Sport
            </p>
            <p
              class="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate"
            >
              {{ event().sport }}
            </p>
          </div>

          <div>
            <p
              class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1"
            >
              Location
            </p>
            <p
              class="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate"
            >
              {{ event().location }}
            </p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:gap-4">
          <div>
            <p
              class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1"
            >
              Date
            </p>
            <p
              class="text-sm sm:text-base font-semibold text-gray-900 dark:text-white"
            >
              {{ event().date | date : 'mediumDate' }}
            </p>
          </div>

          <div>
            <p
              class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1"
            >
              Time
            </p>
            <p
              class="text-sm sm:text-base font-semibold text-gray-900 dark:text-white"
            >
              {{ event().time }}
            </p>
          </div>
        </div>

        <div>
          <p
            class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1"
          >
            Description
          </p>
          <p
            class="text-sm sm:text-base text-gray-700 dark:text-gray-300 line-clamp-2"
          >
            {{ event().description }}
          </p>
        </div>

        <div>
          <p
            class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1"
          >
            Capacity
          </p>
          <p
            class="text-sm sm:text-base font-semibold text-gray-900 dark:text-white"
          >
            {{ event().capacity }} people
          </p>
        </div>
      </div>

      <div
        class="mt-3 sm:mt-4 md:mt-6 pt-3 sm:pt-4 border-t border-gray-200 dark:border-gray-700"
      >
        <div
          class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <p
            class="text-xs text-gray-500 dark:text-gray-400 order-2 sm:order-1"
          >
            Created {{ event().createdAt | date : 'short' }}
          </p>
          <a
            [routerLink]="['/event', event().id]"
            class="w-full sm:w-auto primary-btn cursor-pointer text-sm sm:text-base order-1 sm:order-2 text-center"
          >
            View Details
          </a>
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
