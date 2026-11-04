import { Component, input } from '@angular/core';

const PATHS: Record<string, string> = {
  move: 'm3 17 6-10 4 6 3-5 5 9M6 4h3m8 16h3',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 14h3m4 0h3m-10 4h3',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  terminal: 'm5 7 5 5-5 5m8 0h6M3 3h18v18H3z',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z',
  github:
    'M9 19c-4 1-4-2-6-2m13 5v-4a3 3 0 0 0-1-2c3 0 6-2 6-6a5 5 0 0 0-1-3 5 5 0 0 0 0-4s-2 0-4 2a14 14 0 0 0-8 0C6 3 4 3 4 3a5 5 0 0 0 0 4 5 5 0 0 0-1 3c0 4 3 6 6 6a3 3 0 0 0-1 2v4',
  Running: 'm13 5 2-2m-5 8 3-4 3 4 4 1M5 21l5-6 3 2 1 4M4 10l4-1 2 3-1 3',
  Walking: 'm13 5 1-2m-5 9 3-5 3 5 4 1M7 22l4-7 4 7M4 12l5-3',
  Cycling:
    'M7 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm18 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 17l5-9 5 9H3Zm10 0 5-10h3M6 8h5',
  Tennis: 'm3 21 7-7m0-10c7-7 16 2 9 9S3 11 10 4Zm-1 4 8 8M12 5l8 8m-7-8-5 7m10-4-7 7',
  Swimming:
    'm3 18 3-2 3 2 3-2 3 2 3-2 3 2M8 12l5-6 5 5M3 13l5-1 5 3m4-12a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  Strength: 'm6 6 12 12M3 9l6-6m6 18 6-6M1 7l6-6m10 22 6-6',
  Other: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  people:
    'M16 21v-2a5 5 0 0 0-10 0v2M11 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm7 1a4 4 0 0 1 0 7m3 10v-2a5 5 0 0 0-3-4',
  spark: 'm12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7Z',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
  link: 'm10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  logout: 'M9 3H3v18h6m4-14 5 5-5 5m-6-5h15',
};

@Component({
  selector: 'app-icon',
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="path()" /></svg>',
  styles:
    ':host{display:inline-flex;width:1.25em;height:1.25em;flex-shrink:0}svg{width:100%;height:100%;overflow:visible}',
})
export class Icon {
  readonly name = input('move');
  path(): string {
    return PATHS[this.name()] || PATHS['Other'];
  }
}
