import { signal, type WritableSignal } from '@angular/core';
import { request } from './api';
import type { Profile } from './models';

interface AuthContext {
  viewer: () => Profile | null;
  error: WritableSignal<string>;
  notice: WritableSignal<string>;
  openAtprotoLogin: () => void;
  action: (work: () => Promise<void>) => Promise<void>;
  clearSession: () => void;
  load: () => Promise<void>;
  navigateToFeed: () => void;
}

export class AuthState {
  constructor(private readonly context: AuthContext) {}
  readonly githubConfigured = signal(false);
  readonly atprotoConfigured = signal(false);

  login(): void {
    if (!this.githubConfigured()) {
      this.context.error.set(
        'GitHub sign-in needs setup: add the GitHub OAuth client ID and secret to the Worker. See README.md.',
      );
      return;
    }
    window.location.assign('/auth/github');
  }

  loginAtproto(): void {
    if (!this.atprotoConfigured()) {
      this.context.error.set(
        'AT Protocol sign-in needs setup: add the OAuth signing and session encryption keys to the Worker. See README.md.',
      );
      return;
    }
    this.context.error.set('');
    this.context.notice.set('');
    this.context.openAtprotoLogin();
  }

  signedIn(): boolean {
    if (this.context.viewer()) return true;
    this.context.notice.set(
      'Your story starts here. Sign in with GitHub or AT Protocol to log an activity, join an event, or connect an agent.',
    );
    return false;
  }

  async logout(): Promise<void> {
    await this.context.action(async () => {
      await request('/api/logout', 'POST', {});
      this.context.clearSession();
      await this.context.load();
      this.context.navigateToFeed();
    });
  }
}
