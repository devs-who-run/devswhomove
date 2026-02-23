import {
  Component,
  input,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe, CommonModule } from '@angular/common';
import {
  RegistrationService,
  Registration,
} from '../../services/registration.service';
import { EventService } from '../../services/event.service';
import { AuthApiService } from '../../shared/services/auth-api';

@Component({
  selector: 'app-event-registrants',
  imports: [DatePipe, CommonModule],
  templateUrl: './event-registrants.component.html',
})
export class EventRegistrantsComponent {
  id = input.required<string>();

  private readonly registrationService = inject(RegistrationService);
  private readonly eventService = inject(EventService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthApiService);

  eventName = signal<string>('');
  confirmedRegistrants = signal<Registration[]>([]);
  waitlistRegistrants = signal<Registration[]>([]);
  isLoading = signal(true);
  error = signal<string | null>(null);
  activeTab = signal<'confirmed' | 'waitlist'>('confirmed');

  confirmedCount = computed(() => this.confirmedRegistrants().length);
  waitlistCount = computed(() => this.waitlistRegistrants().length);
  totalCount = computed(() => this.confirmedCount() + this.waitlistCount());

  constructor() {
    effect(() => {
      const eventId = this.id();
      if (eventId) {
        this.loadEventAndRegistrants(eventId);
      }
    });
  }

  private loadEventAndRegistrants(eventId: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    // Load event details
    this.eventService.getEventById(eventId).subscribe({
      next: (event) => {
        this.eventName.set(event.name);

        // Check if user is owner or admin
        const currentUser = this.authService.currentUser();
        if (!currentUser || event.createdByUserId !== currentUser.id) {
          // For now, only allow event creators
          // TODO: Add admin role check when implemented
          this.router.navigate(['/event', eventId]);
          return;
        }

        // Load registrants
        this.loadRegistrants(eventId);
      },
      error: (error) => {
        console.error('Failed to load event:', error);
        this.error.set('Failed to load event details');
        this.isLoading.set(false);
      },
    });
  }

  private loadRegistrants(eventId: string): void {
    this.registrationService.getConfirmedRegistrations(eventId).subscribe({
      next: (confirmed) => {
        this.confirmedRegistrants.set(confirmed);
      },
      error: (error) => {
        console.error('Failed to load confirmed registrants:', error);
        this.error.set('Failed to load registrants');
      },
    });

    this.registrationService.getWaitlistRegistrations(eventId).subscribe({
      next: (waitlist) => {
        this.waitlistRegistrants.set(waitlist);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load waitlist registrants:', error);
        this.error.set('Failed to load registrants');
        this.isLoading.set(false);
      },
    });
  }

  setActiveTab(tab: 'confirmed' | 'waitlist'): void {
    this.activeTab.set(tab);
  }

  goBack(): void {
    this.router.navigate(['/event', this.id()]);
  }

  exportToCSV(): void {
    const registrants =
      this.activeTab() === 'confirmed'
        ? this.confirmedRegistrants()
        : this.waitlistRegistrants();

    if (registrants.length === 0) {
      return;
    }

    const headers =
      this.activeTab() === 'confirmed'
        ? ['Name', 'Registration Date']
        : ['Position', 'Name', 'Registration Date'];

    const rows = registrants.map((reg, index) => {
      const date = new Date(reg.registeredAt).toLocaleString();
      return this.activeTab() === 'confirmed'
        ? [reg.userName, date]
        : [
            reg.waitlistPosition?.toString() || (index + 1).toString(),
            reg.userName,
            date,
          ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.eventName()}-${this.activeTab()}-registrants.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  }
}
