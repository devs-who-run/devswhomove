import { Component, input } from '@angular/core';
import { SPORT_ICON_PATHS } from './sport-icons';

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
  monitor: 'M3 4h18v13H3zM8 21h8m-4-4v4',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z',
  github:
    'M9 19c-4 1-4-2-6-2m13 5v-4a3 3 0 0 0-1-2c3 0 6-2 6-6a5 5 0 0 0-1-3 5 5 0 0 0 0-4s-2 0-4 2a14 14 0 0 0-8 0C6 3 4 3 4 3a5 5 0 0 0 0 4 5 5 0 0 0-1 3c0 4 3 6 6 6a3 3 0 0 0-1 2v4',
  ...SPORT_ICON_PATHS,
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  people:
    'M16 21v-2a5 5 0 0 0-10 0v2M11 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm7 1a4 4 0 0 1 0 7m3 10v-2a5 5 0 0 0-3-4',
  spark: 'm12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7Z',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
  link: 'm10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  share:
    'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  download: 'M12 3v12m-5-5 5 5 5-5M4 21h16',
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
