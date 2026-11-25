import { Routes } from '@angular/router';
import { Component } from '@angular/core';

@Component({ template: '' })
export class RoutePage {}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'feed' },
  { path: 'feed', component: RoutePage },
  { path: 'advent', component: RoutePage },
  { path: 'explore', component: RoutePage },
  { path: 'events', component: RoutePage },
  { path: 'clubs', component: RoutePage },
  { path: 'clubs/:slug', component: RoutePage },
  { path: 'profile', component: RoutePage },
  { path: 'profile/:username', component: RoutePage },
  { path: 'agents', component: RoutePage },
  { path: 'activities/:id', component: RoutePage },
  { path: '**', redirectTo: 'feed' },
];
