import {
  Component,
  input,
  inject,
  computed,
  signal,
  effect,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { EventService } from '../../services/event.service';
import { AuthApiService } from '../../shared/services/auth-api';
import {
  RegistrationService,
  Registration,
  RegistrationStatus,
} from '../../services/registration.service';

@Component({
  selector: 'app-event-details',
  imports: [DatePipe],
  templateUrl: './event-details.component.html',
})
export class EventDetailsComponent {
  id = input.required<string>();

  private readonly eventService = inject(EventService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthApiService);
  private readonly registrationService = inject(RegistrationService);

  public readonly eventResource = rxResource({
    params: this.id,
    stream: () => this.eventService.getEventById(this.id()),
  });

  isDeleting = signal(false);
  showDeleteConfirm = signal(false);

  registrationStatus = signal<Registration | null>(null);
  registrationCounts = signal({
    confirmedCount: 0,
    waitlistCount: 0,
    availableSpots: 0,
  });
  isRegistering = signal(false);
  isUnregistering = signal(false);
  showUnregisterConfirm = signal(false);
  registrationError = signal<string | null>(null);

  isOwner = computed(() => {
    const event = this.eventResource.value();
    const currentUser = this.authService.currentUser();
    return event && currentUser && event.createdByUserId === currentUser.id;
  });

  isRegistered = computed(() => this.registrationStatus() !== null);

  isConfirmed = computed(
    () => this.registrationStatus()?.status === RegistrationStatus.CONFIRMED
  );

  isWaitlisted = computed(
    () => this.registrationStatus()?.status === RegistrationStatus.WAITLIST
  );

  waitlistPosition = computed(
    () => this.registrationStatus()?.waitlistPosition || null
  );

  availableSpots = computed(() => this.registrationCounts().availableSpots);

  canRegister = computed(() => {
    const event = this.eventResource.value();
    const currentUser = this.authService.currentUser();
    return event && currentUser && !this.isOwner() && !this.isRegistered();
  });

  constructor() {
    effect(() => {
      const eventId = this.id();
      const currentUser = this.authService.currentUser();

      if (eventId && currentUser) {
        this.loadRegistrationStatus(eventId, currentUser.id);
        this.loadRegistrationCounts(eventId);
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  navigateToEdit(): void {
    this.router.navigate(['/edit-event', this.id()]);
  }

  confirmDelete(): void {
    this.showDeleteConfirm.set(true);
  }

  cancelDelete(): void {
    this.showDeleteConfirm.set(false);
  }

  deleteEvent(): void {
    this.isDeleting.set(true);
    this.eventService.deleteEvent(this.id()).subscribe({
      next: () => {
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        console.error('Failed to delete event:', error);
        this.isDeleting.set(false);
        this.showDeleteConfirm.set(false);
      },
    });
  }

  private loadRegistrationStatus(eventId: string, userId: string): void {
    this.registrationService
      .getUserRegistrationStatus(eventId, userId)
      .subscribe({
        next: (registration) => {
          this.registrationStatus.set(registration);
        },
        error: (error) => {
          console.error('Failed to load registration status:', error);
          this.registrationStatus.set(null);
        },
      });
  }

  private loadRegistrationCounts(eventId: string): void {
    this.registrationService.getRegistrationCounts(eventId).subscribe({
      next: (counts) => {
        this.registrationCounts.set(counts);
      },
      error: (error) => {
        console.error('Failed to load registration counts:', error);
      },
    });
  }

  registerForEvent(): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    this.isRegistering.set(true);
    this.registrationError.set(null);

    this.registrationService
      .registerForEvent({
        eventId: this.id(),
        userId: currentUser.id,
        userName: currentUser.name || currentUser.email,
      })
      .subscribe({
        next: (registration) => {
          this.registrationStatus.set(registration);
          this.loadRegistrationCounts(this.id());
          this.isRegistering.set(false);
        },
        error: (error) => {
          console.error('Failed to register for event:', error);
          this.registrationError.set(
            'Failed to register for event. Please try again.'
          );
          this.isRegistering.set(false);
        },
      });
  }

  confirmUnregister(): void {
    this.showUnregisterConfirm.set(true);
  }

  cancelUnregister(): void {
    this.showUnregisterConfirm.set(false);
  }

  unregisterFromEvent(): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    this.isUnregistering.set(true);
    this.registrationError.set(null);

    this.registrationService
      .unregisterFromEvent(this.id(), currentUser.id)
      .subscribe({
        next: () => {
          this.registrationStatus.set(null);
          this.loadRegistrationCounts(this.id());
          this.isUnregistering.set(false);
          this.showUnregisterConfirm.set(false);
        },
        error: (error) => {
          console.error('Failed to unregister from event:', error);
          this.registrationError.set('Failed to unregister. Please try again.');
          this.isUnregistering.set(false);
          this.showUnregisterConfirm.set(false);
        },
      });
  }

  navigateToRegistrants(): void {
    this.router.navigate(['/event', this.id(), 'registrants']);
  }
}
