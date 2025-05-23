import { Component } from '@angular/core';

@Component({
  selector: 'app-cta',
  template: `
    <section
      class="relative py-20 bg-gradient-to-br from-blue-600 to-indigo-700 dark:from-blue-800 dark:to-indigo-900"
    >
      <div
        class="absolute inset-0 bg-grid-white/[0.05] bg-[size:20px_20px]"
      ></div>
      <div class="relative px-4 mx-auto max-w-7xl text-center sm:px-6 lg:px-8">
        <h2 class="mb-8 text-3xl font-extrabold text-white sm:text-4xl">
          Ready to Join Our Community?
        </h2>
        <p class="mx-auto mb-10 max-w-2xl text-xl text-blue-100">
          Connect with developers who share your passion for running and coding.
        </p>
        <a
          href="https://discord.gg/gjPdvKjFx3"
          class="inline-flex items-center px-8 py-3 text-base font-medium text-blue-600 bg-white rounded-md border border-transparent transition-all duration-300 transform hover:bg-blue-50 dark:bg-gray-900 dark:text-blue-400 dark:hover:bg-gray-800 hover:-translate-y-1"
          target="_blank"
          rel="noopener noreferrer"
        >
          Join Our Discord
          <svg
            class="-mr-1 ml-2 w-5 h-5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
              clip-rule="evenodd"
            />
          </svg>
        </a>
      </div>
    </section>
  `,
})
export class CtaComponent {}
