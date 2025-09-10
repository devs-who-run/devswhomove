import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AuthApiService } from '../services/auth-api';

@Component({
  selector: 'app-navigation',
  imports: [CommonModule, RouterModule],
  template: `
    @let user = this.authApi.currentUser(); @if (user) {
    <nav class="border-b border-gray-400 dark:border-gray-500">
      <div class="nav-container">
        <div class="nav-bar">
          <div class="flex items-center">
            <a routerLink="/" class="text-brand-large brand-text-hover">
              Devs Who Run
            </a>
          </div>

          <div class="flex items-center space-x-4">
            <div class="flex items-center space-x-3">
              <div routerLink="/profile" class="user-profile-container">
                @if (user.avatar) {
                <img
                  [src]="user.avatar"
                  [alt]="user.name"
                  class="avatar-ring"
                />
                } @else {
                <div class="avatar-fallback">
                  <span class="avatar-text">
                    {{ user.name.charAt(0).toUpperCase() }}
                  </span>
                </div>
                }
                <span class="user-name">
                  {{ user.name }}
                </span>
              </div>

              <button (click)="logout()" class="logout-btn">Logout</button>
            </div>
          </div>
        </div>
      </div>
    </nav>
    }
  `,
})
export class NavigationComponent {
  protected readonly authApi = inject(AuthApiService);
  protected readonly router = inject(Router);

  protected logout(): void {
    this.authApi.logout().subscribe({
      next: () => {
        this.router.navigate(['/']);
      },
      error: (error) => {
        console.error('Logout failed:', error);
        this.router.navigate(['/']);
      },
    });
  }
}
