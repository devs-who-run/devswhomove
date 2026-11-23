import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { Icon } from './icon';
import type { SportEvent } from './models';

@Component({
  selector: 'app-feed-sidebar',
  imports: [DatePipe, Icon],
  templateUrl: './feed-sidebar.html',
  styleUrl: './feed-sidebar.css',
})
export class FeedSidebar {
  readonly events = input.required<SportEvent[]>();
  readonly navigate = output<'events' | 'agents' | 'clubs'>();
  readonly hostEvent = output<void>();
}
