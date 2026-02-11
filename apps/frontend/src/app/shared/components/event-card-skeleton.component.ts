import { Component, input } from '@angular/core';

@Component({
  selector: 'app-event-card-skeleton',
  template: `
    <div
      class="glass-card p-4 sm:p-6 w-full max-w-md mx-auto lg:max-w-none animate-pulse"
    >
      <div class="responsive-flex mb-4">
        <div class="flex items-center space-x-3 min-w-0 flex-1">
          <div
            class="icon-container bg-gray-300 dark:bg-gray-600 rounded-lg w-8 h-8 sm:w-10 sm:h-10"
          ></div>
          <div class="min-w-0 flex-1">
            <div class="h-5 bg-gray-300 dark:bg-gray-600 rounded w-3/4"></div>
          </div>
        </div>
        <div class="h-6 w-20 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
      </div>

      <div class="space-y-4">
        <div class="responsive-grid">
          <div class="field-container">
            <div class="field-content space-y-2">
              <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
              <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
            </div>
          </div>
          <div class="field-container">
            <div class="field-content space-y-2">
              <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
              <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-32"></div>
            </div>
          </div>
        </div>

        <div class="responsive-grid">
          <div class="field-container">
            <div class="field-content space-y-2">
              <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-10"></div>
              <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-28"></div>
            </div>
          </div>
          <div class="field-container">
            <div class="field-content space-y-2">
              <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-10"></div>
              <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
            </div>
          </div>
        </div>

        <div class="field-container">
          <div class="flex-1 space-y-2">
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
            <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-full"></div>
            <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-5/6"></div>
          </div>
        </div>

        <div class="field-container">
          <div class="flex-1 space-y-2">
            <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
            <div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
          </div>
        </div>
      </div>

      <div
        class="mt-4 sm:mt-6 pt-4 border-t border-gray-200 dark:border-gray-700"
      >
        <div
          class="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0"
        >
          <div
            class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-32 order-2 sm:order-1"
          ></div>
          <div class="h-9 bg-gray-300 dark:bg-gray-600 rounded-lg w-28"></div>
        </div>
      </div>
    </div>
  `,
})
export class EventCardSkeletonComponent {
  count = input(6);
}
