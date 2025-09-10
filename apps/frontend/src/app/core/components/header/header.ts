import { Component, inject, signal } from '@angular/core';
import { SocialLoginComponent } from '../../../pages/landing/components/social-login/social-login';
import { AuthApiService } from '../../../shared/services/auth-api';
import { NavigationComponent } from '../../../shared/components/navigation.component';

type DiscordStats = {
  total_members: number;
  online_members: number;
};

@Component({
  selector: 'app-header',
  imports: [SocialLoginComponent, NavigationComponent],
  template: `
    @if(!this.authApi.isAuthenticated()) {
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
    } @else {
    <app-navigation />
    }
  `,
})
export class HeaderComponent {
  protected readonly authApi = inject(AuthApiService);
  discordStats = signal<DiscordStats>({
    total_members: 99,
    online_members: 7,
  });

  menuOpen = signal(false);

  toggleMenu() {
    this.menuOpen.update((value) => !value);
  }
}
