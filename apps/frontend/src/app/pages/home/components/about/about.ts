import { Component, input } from '@angular/core';
import { AboutDetail } from '../../types';

@Component({
  selector: 'app-about',
  template: `
    <section id="about" class="py-20 bg-white dark:bg-gray-900">
      <div class="px-4 mx-auto max-w-7xl sm:px-6 lg:px-8">
        <div class="lg:text-center">
          <h2
            class="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-4xl"
          >
            About Our Community
          </h2>
          <p
            class="mt-4 max-w-2xl text-xl text-gray-600 dark:text-gray-300 lg:mx-auto"
          >
            We're a global community of developers who believe in maintaining a
            healthy balance between coding and movement.
          </p>
        </div>

        <div class="mt-20">
          <div class="grid grid-cols-1 gap-12 lg:grid-cols-3">
            @for (about of aboutDetails(); track about.title) {
            <div
              class="relative p-8 bg-white rounded-2xl shadow-lg transition-all duration-300 transform dark:bg-gray-800 hover:-translate-y-1"
            >
              <div
                class="absolute -top-4 -right-4 w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full opacity-10"
              ></div>
              <div class="mb-4 text-4xl">
                {{ about.icon }}
              </div>
              <h3 class="mb-2 text-xl font-bold text-gray-900 dark:text-white">
                {{ about.title }}
              </h3>
              <p class="text-gray-600 dark:text-gray-300">
                {{ about.description }}
              </p>
            </div>
            }
          </div>
        </div>
      </div>
    </section>
  `,
})
export class AboutComponent {
  aboutDetails = input<AboutDetail[]>();
}
