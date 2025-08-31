import { Route } from '@angular/router';
import { createEventRoutes } from '@devswhorun/create-event';
import { authGuard, guestGuard } from './guards/auth.guard';
import { AuthErrorComponent } from './pages/auth/auth-error/auth-error.component';
import { AuthSuccessComponent } from './pages/auth/auth-success/auth-success.component';

export const appRoutes: Route[] = [
  ...createEventRoutes,
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing.component'),
    canActivate: [guestGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
    canActivate: [authGuard],
  },
  {
    path: 'auth/success',
    component: AuthSuccessComponent,
  },
  {
    path: 'auth/error',
    component: AuthErrorComponent,
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./pages/profile/profile.component').then(
        (m) => m.ProfileComponent
      ),
    canActivate: [authGuard],
  },
  { path: 'landing', redirectTo: '', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
