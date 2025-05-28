import { Component, signal } from '@angular/core';
import { SocialLoginComponent } from '../social-login/social-login.component';

type DiscordStats = {
  total_members: number;
  online_members: number;
};

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [SocialLoginComponent],
  template: `
    <header
      class="overflow-hidden relative bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800"
    >
      <div class="absolute inset-0">
        <div
          class="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 dark:from-blue-500/20 dark:to-purple-500/20"
        ></div>
      </div>
      <div class="relative px-4 py-24 mx-auto max-w-7xl sm:px-6 lg:px-8">
        <div class="text-center">
          <h1
            class="mb-8 text-5xl font-extrabold tracking-tight text-gray-900 md:text-7xl dark:text-white"
          >
            <span
              class="block text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400"
            >
              Devs Who Run
            </span>
          </h1>
          <p
            class="mx-auto mt-3 max-w-md text-base text-gray-600 dark:text-gray-300 sm:text-lg md:mt-5 md:max-w-3xl"
          >
            Join a community of developers who balance debugging with physical
            activities
          </p>
          <!-- The below div will be extracted with separate component and will be handled with the issue: https://github.com/devs-who-run/devswhomove/issues/6 -->
          <!-- <div class="flex gap-x-6 justify-center mt-10">
            <div class="flex gap-4 mb-6">
              <div
                class="px-6 py-4 bg-white rounded-lg shadow-sm dark:bg-gray-800"
              >
                <div class="flex items-center">
                  <svg
                    class="w-6 h-6 mr-3 text-blue-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"
                    ></path>
                  </svg>
                  <div>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Total Members
                    </p>
                    <p class="text-2xl font-bold text-gray-900 dark:text-white">
                      {{ discordStats().total_members }}
                    </p>
                  </div>
                </div>
              </div>
              <div
                class="px-6 py-4 bg-white rounded-lg shadow-sm dark:bg-gray-800"
              >
                <div class="flex items-center">
                  <svg
                    class="w-6 h-6 mr-3 text-green-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16z"
                      clip-rule="evenodd"
                    ></path>
                  </svg>
                  <div>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Online Now
                    </p>
                    <p class="text-2xl font-bold text-gray-900 dark:text-white">
                      {{ discordStats().online_members }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div> -->
          <!-- <div class="flex gap-x-6 justify-center mt-4 mb-6">
            <a
              href="https://discord.gg/gjPdvKjFx3"
              class="px-8 py-3 font-semibold text-white bg-blue-600 rounded-md transition-all transform hover:-translate-y-1 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 inline-flex items-center gap-2"
              rel="noopener noreferrer"
              target="_blank"
              aria-label="Join Our Discord Community (opens in new tab)"
            >
              Join Discord
              <svg
                class="w-5 h-5"
                fill="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
                />
              </svg>
            </a>
            <a
              href="https://github.com/devs-who-run/devswhomove"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Contribute on GitHub"
              class="px-8 py-3 font-semibold text-blue-600 bg-white rounded-md transition-all transform hover:-translate-y-1 hover:bg-gray-50 dark:bg-gray-800 dark:text-blue-400 dark:hover:bg-gray-700 inline-flex items-center gap-2"
            >
              Contribute
              <svg
                class="w-5 h-5"
                fill="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                />
              </svg>
            </a>
          </div> -->
          <div class="mt-6 mb-4">
            <h3
              class="mb-4 text-xl font-semibold text-gray-800 dark:text-gray-200"
            >
              Become our member
            </h3>
            <app-social-login />
          </div>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent {
  discordStats = signal<DiscordStats>({
    total_members: 99,
    online_members: 7,
  });

  menuOpen = signal(false);

  toggleMenu() {
    this.menuOpen.update((value) => !value);
  }
}
