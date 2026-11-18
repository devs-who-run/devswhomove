import { signal, type WritableSignal } from '@angular/core';
import { errorMessage, request } from './api';
import type { EventAttendee, SportEvent } from './models';

interface EventActionsContext {
  signedIn(): boolean;
  action(work: () => Promise<void>): Promise<void>;
  load(): Promise<void>;
  refreshClub(): Promise<void>;
  error: WritableSignal<string>;
  notice: WritableSignal<string>;
}

export class EventActions {
  readonly attendeeEvent = signal<string | null>(null);
  readonly eventAttendees = signal<EventAttendee[]>([]);
  readonly loadingAttendees = signal<string | null>(null);
  private attendeeRequest = 0;

  constructor(private readonly context: EventActionsContext) {}

  async join(event: SportEvent): Promise<void> {
    if (!this.context.signedIn()) return;
    await this.context.action(async () => {
      const joining = !event.joined && !event.waitlisted;
      const membership = await request<{ joined: boolean; waitlisted: boolean }>(
        `/api/events/${encodeURIComponent(event.id)}/join`,
        'POST',
        { join: joining },
      );
      this.context.notice.set(
        joining
          ? membership.joined
            ? 'You are in! The event is now in your upcoming sessions.'
            : membership.waitlisted
              ? 'You’re on the waitlist.'
              : 'Your event RSVP could not be confirmed.'
          : 'Your RSVP was withdrawn.',
      );
      await this.context.load();
      await this.context.refreshClub();
    });
  }

  async toggleAttendees(event: SportEvent): Promise<void> {
    const requestId = ++this.attendeeRequest;
    if (this.attendeeEvent() === event.id) {
      this.attendeeEvent.set(null);
      this.loadingAttendees.set(null);
      return;
    }
    this.attendeeEvent.set(event.id);
    this.eventAttendees.set([]);
    this.loadingAttendees.set(event.id);
    this.context.error.set('');
    try {
      const result = await request<{ attendees: EventAttendee[] }>(
        `/api/events/${encodeURIComponent(event.id)}/attendees`,
      );
      if (requestId === this.attendeeRequest) this.eventAttendees.set(result.attendees);
    } catch (error) {
      if (requestId === this.attendeeRequest) {
        this.context.error.set(errorMessage(error));
        this.attendeeEvent.set(null);
      }
    } finally {
      if (requestId === this.attendeeRequest) this.loadingAttendees.set(null);
    }
  }

  async cancel(event: SportEvent): Promise<void> {
    if (!window.confirm(`Cancel "${event.title}" for everyone?`)) return;
    await this.context.action(async () => {
      await request(`/api/events/${encodeURIComponent(event.id)}`, 'POST', {});
      await this.context.load();
      await this.context.refreshClub();
      this.context.notice.set('Event cancelled. It is no longer available to join.');
    });
  }
}
