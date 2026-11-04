import { Routes } from '@angular/router';
import { Component } from '@angular/core';

@Component({ template: '' })
export class RoutePage {}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'feed' },
  { path: 'feed', component: RoutePage },
  { path: 'events', component: RoutePage },
  { path: 'profile', component: RoutePage },
  { path: 'profile/:username', component: RoutePage },
  { path: 'agents', component: RoutePage },
  { path: '**', redirectTo: 'feed' },
];
