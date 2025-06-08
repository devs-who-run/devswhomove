import { Route } from '@angular/router';
import { CreateEventComponent } from './create-event/create-event.component';

export const createEventRoutes: Route[] = [
  { path: 'event/create', component: CreateEventComponent },
];
