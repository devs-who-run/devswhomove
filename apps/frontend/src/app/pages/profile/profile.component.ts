import { Component, inject } from '@angular/core';
import { AuthApiService } from '../../shared/services/auth-api';

@Component({
  selector: 'app-profile',
  imports: [],
  template: `
    @let user = this.authApi.currentUser(); @if (user) {
    <main class="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div
          class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-white/20 dark:border-gray-700/20"
        >
          <div class="flex items-center mb-6">
            <div
              class="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl"
            >
              <svg
                class="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            <h2 class="ml-4 text-2xl font-bold text-gray-900 dark:text-white">
              Personal Info
            </h2>
          </div>

          <div class="space-y-6">
            <div class="flex items-start space-x-4">
              <div
                class="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2"
              ></div>
              <div class="flex-1">
                <p
                  class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                  Full Name
                </p>
                <p
                  class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                >
                  {{ user.name }}
                </p>
              </div>
            </div>

            <div class="flex items-start space-x-4">
              <div
                class="flex-shrink-0 w-2 h-2 bg-green-500 rounded-full mt-2"
              ></div>
              <div class="flex-1">
                <p
                  class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                  Email Address
                </p>
                <p
                  class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                >
                  {{ user.email }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div
          class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-white/20 dark:border-gray-700/20"
        >
          <div class="flex items-center mb-6">
            <div
              class="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl"
            >
              <svg
                class="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <h2 class="ml-4 text-2xl font-bold text-gray-900 dark:text-white">
              Account Details
            </h2>
          </div>

          <div class="space-y-6">
            <div class="flex items-start space-x-4">
              <div
                class="flex-shrink-0 w-2 h-2 bg-purple-500 rounded-full mt-2"
              ></div>
              <div class="flex-1">
                <p
                  class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                  Authentication Provider
                </p>
                <div class="mt-1 flex items-center space-x-2">
                  <svg
                    class="w-5 h-5 text-gray-900 dark:text-white"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                    />
                  </svg>
                  <span
                    class="text-lg font-semibold text-gray-900 dark:text-white capitalize"
                    >{{ user.provider }}</span
                  >
                </div>
              </div>
            </div>

            <div class="flex items-start space-x-4">
              <div
                class="flex-shrink-0 w-2 h-2 bg-indigo-500 rounded-full mt-2"
              ></div>
              <div class="flex-1">
                <p
                  class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                  User ID
                </p>
                <p
                  class="mt-1 text-sm font-mono bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-lg text-gray-900 dark:text-white break-all"
                >
                  {{ user.id }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
    }
  `,
})
export class ProfileComponent {
  protected readonly authApi = inject(AuthApiService);
}
