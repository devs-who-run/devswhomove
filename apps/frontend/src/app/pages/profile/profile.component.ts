import { Component, inject, signal } from '@angular/core';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { AuthApiService } from '../../shared/services/auth-api';
import {
  UserProfileApiService,
  UpdateUserProfileRequest,
} from '../../shared/services/user-profile-api';

interface ProfileFormData {
  name: string;
  country: string;
  city: string;
}

@Component({
  selector: 'app-profile',
  imports: [FormField],
  template: `
    @let user = this.authApi.currentUser(); @if (user) {
    <main class="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- Personal Info Card -->
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

          @if (isEditing()) {
          <form novalidate (submit)="onSubmit($event)">
            <div class="space-y-6">
              <div class="flex items-start space-x-4">
                <div class="flex-1">
                  <p
                    class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                  >
                    Full Name
                  </p>
                  <input
                    type="text"
                    [formField]="profileForm.name"
                    class="mt-1 w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  @if (profileForm.name().touched() &&
                  profileForm.name().invalid()) {
                  <div class="mt-1">
                    @for (error of profileForm.name().errors(); track error) {
                    <p class="text-sm text-red-500 dark:text-red-400">
                      {{ error.message }}
                    </p>
                    }
                  </div>
                  }
                </div>
              </div>

              <div class="flex items-start space-x-4">
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
          </form>
          } @else {
          <div class="space-y-6">
            <div class="flex items-start space-x-4">
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
          }
        </div>

        <!-- Address Details Card -->
        <div
          class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-white/20 dark:border-gray-700/20"
        >
          <div class="flex items-center justify-between mb-6">
            <div class="flex items-center">
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
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
              <h2 class="ml-4 text-2xl font-bold text-gray-900 dark:text-white">
                Address Details
              </h2>
            </div>
            @if (!isEditing()) {
            <button
              (click)="startEditing()"
              class="cursor-pointer px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
            >
              Edit
            </button>
            }
          </div>

          @if (isEditing()) {
          <form novalidate (submit)="onSubmit($event)">
            <div class="space-y-6">
              <div class="flex items-start space-x-4">
                <div class="flex-1">
                  <p
                    class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                  >
                    Country
                  </p>
                  <input
                    type="text"
                    [formField]="profileForm.country"
                    placeholder="Enter your country"
                    class="mt-1 w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div class="flex items-start space-x-4">
                <div class="flex-1">
                  <p
                    class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                  >
                    City
                  </p>
                  <input
                    type="text"
                    [formField]="profileForm.city"
                    placeholder="Enter your city"
                    class="mt-1 w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div class="flex space-x-3 pt-2">
                <button
                  type="submit"
                  [disabled]="profileForm().submitting()"
                  class="cursor-pointer flex-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {{
                    profileForm().submitting() ? 'Saving...' : 'Save Changes'
                  }}
                </button>
                <button
                  type="button"
                  (click)="cancelEditing()"
                  [disabled]="profileForm().submitting()"
                  class="cursor-pointer flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>

              @if (saveError()) {
              <p class="text-sm text-red-500 dark:text-red-400">
                {{ saveError() }}
              </p>
              }
            </div>
          </form>
          } @else {
          <div class="space-y-6">
            <div class="flex items-start space-x-4">
              <div class="flex-1">
                <p
                  class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                  Country
                </p>
                <p
                  class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                >
                  {{ user.country || 'Not set' }}
                </p>
              </div>
            </div>

            <div class="flex items-start space-x-4">
              <div class="flex-1">
                <p
                  class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                  City
                </p>
                <p
                  class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                >
                  {{ user.city || 'Not set' }}
                </p>
              </div>
            </div>
          </div>
          }
        </div>
      </div>
    </main>
    }
  `,
})
export class ProfileComponent {
  protected readonly authApi = inject(AuthApiService);
  private readonly userProfileApi = inject(UserProfileApiService);

  isEditing = signal(false);
  saveError = signal('');

  profileModel = signal<ProfileFormData>({
    name: '',
    country: '',
    city: '',
  });

  profileForm = form(this.profileModel, (p) => {
    required(p.name, { message: 'Name is required' });
  });

  startEditing(): void {
    const user = this.authApi.currentUser();
    if (user) {
      this.profileModel.set({
        name: user.name || '',
        country: user.country || '',
        city: user.city || '',
      });
      this.saveError.set('');
      this.isEditing.set(true);
    }
  }

  cancelEditing(): void {
    this.isEditing.set(false);
    this.saveError.set('');
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    submit(this.profileForm, async () => {
      await this.saveProfile();
    });
  }

  private async saveProfile(): Promise<void> {
    const user = this.authApi.currentUser();
    if (!user) return;

    this.saveError.set('');

    const updateData: UpdateUserProfileRequest = {
      name: this.profileForm.name().value(),
      country: this.profileForm.country().value(),
      city: this.profileForm.city().value(),
    };

    try {
      const profile = await firstValueFrom(
        this.userProfileApi.updateProfile(user.id, updateData)
      );
      this.authApi.currentUser.set({
        ...user,
        name: profile.name,
        country: profile.country,
        city: profile.city,
      });
      localStorage.setItem(
        'devswhorun_user',
        JSON.stringify(this.authApi.currentUser())
      );
      this.isEditing.set(false);
    } catch (err) {
      console.error('Failed to update profile:', err);
      this.saveError.set('Failed to save changes. Please try again.');
    }
  }
}
