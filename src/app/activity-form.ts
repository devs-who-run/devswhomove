import { Component, inject, input, model, output, signal } from '@angular/core';
import { ControlContainer, FormsModule, NgForm } from '@angular/forms';
import { ActivityRoute } from './activity-route';
import { errorMessage } from './api';
import { localDate } from './date';
import { TRIM_OPTIONS } from './route-geometry';
import { Icon } from './icon';
import { SPORTS, type Profile, type Sport, type Visibility } from './models';
import type { RouteImport } from './route-import';

export interface ActivityFormValue {
  title: string;
  sport: Sport;
  occurredAt: string;
  duration: number;
  distance: number | null;
  notes: string;
  visibility: Visibility;
}

@Component({
  selector: 'app-activity-form',
  imports: [ActivityRoute, FormsModule, Icon],
  templateUrl: './activity-form.html',
  styleUrls: ['./form-fields.css', './activity-form.css'],
  viewProviders: [{ provide: ControlContainer, useFactory: () => inject(NgForm) }],
})
export class ActivityForm {
  readonly value = input.required<ActivityFormValue>();
  readonly viewer = input<Profile | null>(null);
  readonly profileHidden = input(false);
  readonly photoPreview = input('');
  readonly photoBusy = input(false);
  readonly saving = input(false);
  readonly publicDisclosure = model(false);
  readonly choosePhoto = output<Event>();
  readonly removePhoto = output<void>();
  readonly routeImport = input<RouteImport | null>(null);
  readonly sports = SPORTS;
  readonly trimOptions = TRIM_OPTIONS;
  readonly workoutError = signal('');

  /** Read a FIT, GPX or TCX file in the browser and fill in the activity from it. */
  async importWorkout(event: Event): Promise<void> {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    fileInput.value = '';
    const routeImport = this.routeImport();
    if (!file || !routeImport) return;
    this.workoutError.set('');
    try {
      const workout = await routeImport.load(file);
      if (!workout) return;
      const form = this.value();
      form.sport = workout.sport;
      // The duration field accepts tenths of a minute.
      form.duration = Math.max(1, Math.round(workout.duration * 10) / 10);
      form.distance = workout.distance;
      form.occurredAt = localDate(new Date(workout.occurredAt));
      if (!form.title.trim()) form.title = workout.title;
    } catch (error) {
      routeImport.reset();
      this.workoutError.set(errorMessage(error));
    }
  }

  removeRoute(): void {
    this.routeImport()?.reset();
    this.workoutError.set('');
  }
}
