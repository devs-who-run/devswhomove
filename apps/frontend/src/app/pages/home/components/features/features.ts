import { Component, input } from '@angular/core';
import { Feature } from '../../types';

@Component({
  selector: 'app-features',
  template: `
    <section class="py-20 bg-gray-50 dark:bg-gray-800">
      <div class="px-4 mx-auto max-w-7xl sm:px-6 lg:px-8">
        <div class="mb-16 lg:text-center">
          <h2
            class="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-4xl"
          >
            Community Features
          </h2>
        </div>
        <div
          class="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4"
          role="list"
          aria-label="Community features"
        >
          @for (feature of features(); track feature.title) {
          <div
            class="p-6 bg-white rounded-lg shadow-lg transition-all duration-300 transform dark:bg-gray-900 hover:-translate-y-1"
            role="listitem"
          >
            <div class="mb-4 text-3xl">
              {{ feature.icon }}
            </div>
            <h3 class="mb-2 text-xl font-bold text-gray-900 dark:text-white">
              {{ feature.title }}
            </h3>
            <p class="text-gray-600 dark:text-gray-300">
              {{ feature.description }}
            </p>
          </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class FeaturesComponent {
  features = input<Feature[]>();
}
