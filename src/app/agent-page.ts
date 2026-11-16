import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgentTokens } from './agent-tokens';
import { Icon } from './icon';
import { Login } from './login';
import type { Profile } from './models';

@Component({
  selector: 'app-agent-page',
  imports: [DatePipe, FormsModule, Icon, Login],
  templateUrl: './agent-page.html',
  styleUrls: ['./agent-page.css', './agent-page-form.css'],
})
export class AgentPage {
  readonly viewer = input<Profile | null>(null);
  readonly saving = input(false);
  readonly agent = input.required<AgentTokens>();
  readonly githubLogin = output<void>();
  readonly atprotoLogin = output<void>();
}
