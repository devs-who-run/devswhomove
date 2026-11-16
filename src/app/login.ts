import { Component, input, output } from '@angular/core';
import { Icon } from './icon';
import type { Profile } from './models';

type LoginPlacement = 'sidebar' | 'header' | 'profile' | 'agents';

@Component({
  selector: 'app-login',
  imports: [Icon],
  templateUrl: './login.html',
  styleUrl: './login.css',
  host: {
    '[class.sidebar-bottom]': "placement() === 'sidebar'",
    '[class.header-login]': "placement() === 'header'",
  },
})
export class Login {
  readonly placement = input.required<LoginPlacement>();
  readonly viewer = input<Profile | null>(null);
  readonly saving = input(false);
  readonly githubLogin = output<void>();
  readonly atprotoLogin = output<void>();
  readonly signOut = output<void>();

  initials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
}
