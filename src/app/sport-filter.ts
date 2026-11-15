import { Component, input, output } from '@angular/core';
import { Icon } from './icon';
import { SPORTS, type Sport } from './models';

@Component({
  host: { class: 'sport-filters', role: 'group', '[attr.aria-label]': 'ariaLabel()' },
  imports: [Icon],
  selector: 'app-sport-filter',
  styleUrl: './sport-filter.css',
  template: `
    <button
      [class.selected]="selected() === 'All'"
      [attr.aria-pressed]="selected() === 'All'"
      (click)="selectedChange.emit('All')"
    >
      {{ allLabel() }}
    </button>
    @for (sport of sports(); track sport) {
      <button
        [class.selected]="selected() === sport"
        [attr.aria-pressed]="selected() === sport"
        (click)="selectedChange.emit(sport)"
      >
        <app-icon [name]="sport" />{{ sport }}
      </button>
    }
  `,
})
export class SportFilter {
  readonly selected = input.required<Sport | 'All'>();
  readonly ariaLabel = input.required<string>();
  readonly allLabel = input.required<string>();
  readonly sports = input<readonly Sport[]>(SPORTS);
  readonly selectedChange = output<Sport | 'All'>();
}
