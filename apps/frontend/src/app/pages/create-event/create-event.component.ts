import {
  Component,
  signal,
  inject,
  input,
  effect,
  computed,
} from '@angular/core';
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
  id = input<string>();

  eventTypeOptions = eventTypeOptions;
  sportOptions = sportOptions;
  submitError = signal<string | null>(null);
  isLoading = signal(false);

  private readonly eventService = inject(EventService);
  private readonly router = inject(Router);
  private readonly userState = inject(UserState);

  isEditMode = computed(() => !!this.id());

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
    createdByUserId: this.userState.authApi.currentUser()?.id || '',
  });

  eventForm = form(this.eventModel, eventSchema);

  constructor() {
    effect(() => {
      const eventId = this.id();
      if (eventId) {
        this.loadEvent(eventId);
      }
    });
  }

  private loadEvent(eventId: string): void {
    this.isLoading.set(true);
    this.eventService.getEventById(eventId).subscribe({
      next: (event) => {
        this.eventModel.set({
          name: event.name,
          conference: event.conference,
          eventType: event.eventType,
          sport: event.sport,
          date: event.date,
          time: event.time,
          location: event.location,
          capacity: event.capacity,
          description: event.description,
          createdBy: event.createdBy,
          createdByUserId: event.createdByUserId,
        });
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error loading event:', error);
        this.submitError.set('Failed to load event');
        this.isLoading.set(false);
      },
    });
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitError.set(null);
    submit(this.eventForm, async (form) => {
      const eventId = this.id();
      const operation = eventId
        ? this.eventService.updateEvent(eventId, form().value())
        : this.eventService.createEvent(form().value());

      operation.subscribe({
        next: () => {
          if (eventId) {
            this.router.navigate(['/event', eventId]);
          } else {
            this.router.navigate(['/dashboard']);
          }
        },
        error: (error) => {
          const errorMessage =
            error instanceof Error
              ? error.message
              : `Failed to ${
                  eventId ? 'update' : 'create'
                } event. Please try again.`;
          this.submitError.set(errorMessage);
          console.error(
            `Error ${eventId ? 'updating' : 'creating'} event:`,
            error
          );
        },
      });
    });
  }

  onCancel(): void {
    const eventId = this.id();
    if (eventId) {
      this.router.navigate(['/event', eventId]);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
