import { Component, ElementRef, input, model, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivityForm, type ActivityFormValue } from './activity-form';
import { EventForm, type EventFormValue } from './event-form';
import { Icon } from './icon';
import { SPORTS, type Club, type Profile, type Sport, type Visibility } from './models';

export type Modal = 'activity' | 'event' | 'profile' | 'club' | 'atproto-login' | null;
export interface ClubFormValue {
  name: string;
  description: string;
  sport: Sport | '';
}
export interface ProfileFormValue {
  name: string;
  bio: string;
  location: string;
  visibility: Visibility;
  sports: Sport[];
}

@Component({
  selector: 'app-dialog',
  imports: [ActivityForm, EventForm, FormsModule, Icon],
  templateUrl: './app-dialog.html',
  styleUrls: ['./form-fields.css', './app-dialog.css'],
})
export class AppDialog {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  readonly modal = input<Modal>(null);
  readonly viewer = input<Profile | null>(null);
  readonly saving = input(false);
  readonly error = input('');
  readonly editingEvent = input<string | null>(null);
  readonly activityForm = input.required<ActivityFormValue>();
  readonly eventForm = input.required<EventFormValue>();
  readonly clubForm = input.required<ClubFormValue>();
  readonly profileForm = input.required<ProfileFormValue>();
  readonly eventClubOptions = input<Club[]>([]);
  readonly profileHidden = input(false);
  readonly photoPreview = input('');
  readonly photoBusy = input(false);
  readonly publicDisclosure = model(false);
  readonly atprotoHandle = model('');
  readonly closeModal = output<void>();
  readonly save = output<void>();
  readonly beginAtprotoLogin = output<void>();
  readonly toggleSport = output<Sport>();
  readonly choosePhoto = output<Event>();
  readonly removePhoto = output<void>();
  readonly sports = SPORTS;

  show(): void {
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }
}
