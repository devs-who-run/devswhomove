import { Component, inject, input, model, output } from '@angular/core';
import { ControlContainer, FormsModule, NgForm } from '@angular/forms';
import { Icon } from './icon';
import { SPORTS, type Profile, type Sport, type Visibility } from './models';

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
  imports: [FormsModule, Icon],
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
  readonly sports = SPORTS;
}
