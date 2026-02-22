import { Component, input } from '@angular/core';

@Component({
  selector: 'app-event-card-skeleton',
  template: `
    <div class="glass-card p-3 sm:p-4 md:p-6 w-full animate-pulse">
      <div
        class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3 sm:mb-4"
      >
        <div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div
            class="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gray-300 dark:bg-gray-600"
          ></div>
          <div class="min-w-0 flex-1">
            <div
              class="h-4 sm:h-5 bg-gray-300 dark:bg-gray-600 rounded w-3/4"
            ></div>
          </div>
        </div>
        <div
          class="h-6 w-20 bg-gray-300 dark:bg-gray-600 rounded-full self-start"
        ></div>
      </div>

      <div class="space-y-3 sm:space-y-4">
        <div class="grid grid-cols-2 gap-3 sm:gap-4">
          <div class="space-y-1.5">
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
            <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-20"></div>
          </div>
          <div class="space-y-1.5">
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
            <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-28"></div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:gap-4">
          <div class="space-y-1.5">
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-10"></div>
            <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
          </div>
          <div class="space-y-1.5">
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-10"></div>
            <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
          </div>
        </div>

        <div class="space-y-1.5">
          <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
          <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-full"></div>
          <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-5/6"></div>
        </div>

        <div class="space-y-1.5">
          <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
          <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
        </div>
      </div>

      <div
        class="mt-3 sm:mt-4 md:mt-6 pt-3 sm:pt-4 border-t border-gray-200 dark:border-gray-700"
      >
        <div
          class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div
            class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-32 order-2 sm:order-1"
          ></div>
          <div
            class="h-9 bg-gray-300 dark:bg-gray-600 rounded-lg w-full sm:w-28 order-1 sm:order-2"
          ></div>
        </div>
      </div>
    </div>
  `,
})
export class EventCardSkeletonComponent {
  count = input(6);
}
