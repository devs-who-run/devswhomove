import { Route } from '@angular/router';
import { createEventRoutes } from '@devswhorun/create-event';
export const appRoutes: Route[] = [
  ...createEventRoutes,
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  { path: 'home', redirectTo: '', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
