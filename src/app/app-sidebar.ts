import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';
import { Login } from './login';
import type { Profile } from './models';

export type Page = 'feed' | 'events' | 'clubs' | 'profile' | 'agents' | 'activity';

@Component({
  selector: 'app-sidebar',
  imports: [Icon, Login, RouterLink],
  templateUrl: './app-sidebar.html',
  styleUrl: './app-sidebar.css',
})
export class AppSidebar {
  readonly nav =
    input.required<{ page: Page; label: string; mobileLabel: string; icon: string }[]>();
  readonly page = input.required<Page>();
  readonly viewer = input<Profile | null>(null);
  readonly saving = input(false);
  readonly navigate = output<'events'>();
  readonly githubLogin = output<void>();
  readonly atprotoLogin = output<void>();
  readonly signOut = output<void>();
}
