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
    <header class="header-bg">
      <div class="relative section-container py-24">
        <div class="centered-content">
          <h1 class="text-hero">
            <span class="block brand-text"> Devs Who Run </span>
          </h1>
          <p class="text-hero-subtitle">
            Join a community of developers who balance debugging with physical
            activities
          </p>
          <div class="mt-6 mb-4">
            <h3 class="text-section-title">Become our member</h3>
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
