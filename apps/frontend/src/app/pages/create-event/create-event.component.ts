import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { form, FormField, submit } from '@angular/forms/signals';
import { EventService } from '../../services/event.service';
import {
  EventForm,
  eventSchema,
  eventTypeOptions,
  sportOptions,
} from './event-form.schema';
import { FormsModule } from '@angular/forms';
import { UserState } from '../../shared/services/user-state';

@Component({
  selector: 'app-create-event',
  imports: [CommonModule, FormField, FormsModule],
  templateUrl: './create-event.component.html',
  styleUrls: ['./create-event.component.css'],
})
export class CreateEventComponent {
  eventTypeOptions = eventTypeOptions;
  sportOptions = sportOptions;
  submitError = signal<string | null>(null);

  private readonly eventService = inject(EventService);
  private readonly router = inject(Router);
  private readonly userState = inject(UserState);

  eventModel = signal<EventForm>({
    name: '',
    conference: '',
    eventType: '',
    sport: '',
    date: '',
    time: '',
    location: '',
    capacity: 0,
    description: '',
    createdBy: this.userState.currentUserName || '',
  });

  eventForm = form(this.eventModel, eventSchema);

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitError.set(null);
    submit(this.eventForm, async (form) => {
      this.eventService.createEvent(form().value()).subscribe({
        next: () => {
          this.router.navigate(['/dashboard']);
        },
        error: (error) => {
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Failed to create event. Please try again.';
          this.submitError.set(errorMessage);
          console.error('Error creating event:', error);
        },
      });
    });
  }

  onCancel(): void {
    this.router.navigate(['/dashboard']);
  }
}
