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

      <div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-16">
          <div class="flex items-center">
            <a
              routerLink="/"
              class="text-xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 hover:from-blue-700 hover:to-indigo-700 dark:hover:from-blue-300 dark:hover:to-indigo-300 transition-all"
            >
              Devs Who Run
            </a>
          </div>

          <div class="flex items-center space-x-4">
            <div class="flex items-center space-x-3">
              <div
                routerLink="/profile"
                class="flex cursor-pointer items-center space-x-3 px-4 py-2 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-sm"
              >
                @if (user.avatar) {
                <img
                  [src]="user.avatar"
                  [alt]="user.name"
                  class="w-8 h-8 rounded-full ring-2 ring-blue-500/20"
                />
                } @else {
                <div
                  class="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shadow-sm"
                >
                  <span class="text-sm font-bold text-white">
                    {{ user.name.charAt(0).toUpperCase() }}
                  </span>
                </div>
                }
                <span
                  class="hidden md:block text-sm font-semibold text-gray-900 dark:text-white"
                >
                  {{ user.name }}
                </span>
              </div>

              <button
                (click)="logout()"
                class="px-4 cursor-pointer py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-all transform hover:-translate-y-0.5 backdrop-blur-sm"
              >
                Logout
              </button>
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
