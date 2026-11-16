import { Component, inject, input, model } from '@angular/core';
import { ControlContainer, FormsModule, NgForm } from '@angular/forms';
import { SPORTS, type Club, type Profile, type Sport } from './models';

export interface EventFormValue {
  title: string;
  sport: Sport;
  startsAt: string;
  location: string;
  description: string;
  level: string;
  capacity: number;
  conferenceName: string;
  conferenceUrl: string;
  clubId: string;
}

@Component({
  selector: 'app-event-form',
  imports: [FormsModule],
  templateUrl: './event-form.html',
  styleUrl: './form-fields.css',
  viewProviders: [{ provide: ControlContainer, useFactory: () => inject(NgForm) }],
})
export class EventForm {
  readonly value = input.required<EventFormValue>();
  readonly viewer = input<Profile | null>(null);
  readonly clubs = input<Club[]>([]);
  readonly publicDisclosure = model(false);
  readonly sports = SPORTS;
}
