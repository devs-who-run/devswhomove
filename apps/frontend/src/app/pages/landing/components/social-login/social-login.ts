import { Component, inject } from '@angular/core';
import { ICON_NAME } from '../../../../shared/directives/svg/svg-icon-constants';
import { SvgIconDirective } from '../../../../shared/directives/svg/svg-icon';
import { AuthApiService } from '../../../../shared/services/auth-api';

@Component({
  selector: 'app-social-login',
  imports: [SvgIconDirective],
  template: `
    <div class="flex gap-3 align-center justify-center">
      <button
        (click)="handleSocialLogin('google')"
        class="social-btn-google"
        aria-label="Sign in with Google"
      >
        <span
          appSvgIcon
          [iconName]="iconName.google"
          fill="#4285F4"
          iconClass="w-5 h-5"
        ></span>
        <span class="hidden sm:block">Sign in with Google</span>
      </button>
      <button
        (click)="handleSocialLogin('github')"
        [disabled]="isLoading"
        class="social-btn-github"
        aria-label="Sign in with GitHub"
      >
        <span
          appSvgIcon
          [iconName]="iconName.github"
          iconClass="w-5 h-5"
        ></span>
        <span class="hidden sm:block">{{
          isLoading ? 'Connecting...' : 'Sign in with GitHub'
        }}</span>
      </button>
    </div>
  `,
})
export class SocialLoginComponent {
  protected readonly iconName = ICON_NAME;
  private authApi = inject(AuthApiService);
  protected isLoading = false;

  handleSocialLogin(provider: 'google' | 'github'): void {
    if (provider === 'github') {
      this.handleGitHubLogin();
    } else {
      alert('Google login feature coming soon!');
    }
  }

  private handleGitHubLogin(): void {
    this.isLoading = true;

    this.authApi.initiateGitHubLogin().subscribe({
      next: (response) => {
        if (response.success) {
          console.log('Redirecting to GitHub OAuth...');
        }
      },
      error: (error) => {
        console.error('GitHub login failed:', error);
        alert('Failed to initiate GitHub login. Please try again.');
        this.isLoading = false;
      },
    });
  }
}
