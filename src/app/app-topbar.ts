import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Icon } from './icon';
import { Login } from './login';
import type { Profile } from './models';
import { Theme } from './theme';

@Component({
  selector: 'app-topbar',
  imports: [FormsModule, Icon, Login],
  templateUrl: './app-topbar.html',
  styleUrls: ['./page-layout.css', './app-topbar.css'],
})
export class AppTopbar {
  readonly theme = inject(Theme);
  readonly viewer = input<Profile | null>(null);
  readonly saving = input(false);
  readonly githubLogin = output<void>();
  readonly atprotoLogin = output<void>();
  readonly signOut = output<void>();
  readonly logActivity = output<void>();
}
