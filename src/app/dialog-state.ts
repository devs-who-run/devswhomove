import { signal, type WritableSignal } from '@angular/core';
import { errorMessage, request } from './api';
import type { Participation } from './activity-social';
import type { Modal } from './app-dialog';
import type { Page } from './app-sidebar';
import { conferenceLink } from './conference-link';
import { localDate } from './date';
import type { Club, ClubDetail, Profile, Sport, SportEvent, Visibility } from './models';
import { preparePhoto } from './photo';

interface DialogContext {
  viewer: () => Profile | null;
  page: () => Page;
  clubs: () => Club[];
  clubDetail: () => ClubDetail | null;
  participation: () => Participation;
  signedIn: () => boolean;
  saving: WritableSignal<boolean>;
  error: WritableSignal<string>;
  notice: WritableSignal<string>;
  show: () => void;
  close: () => void;
  load: () => Promise<void>;
  refreshClub: () => Promise<void>;
  navigateEvents: () => void;
  navigateToClub: (slug: string) => void;
}

export class DialogState {
  constructor(private readonly context: DialogContext) {}
  readonly modal = signal<Modal>(null);
  atprotoHandle = '';
  readonly photo = signal<Blob | null>(null);
  readonly photoPreview = signal('');
  readonly photoBusy = signal(false);
  private photoRequest = 0;
  readonly publicDisclosure = signal(false);
  readonly editingEvent = signal<string | null>(null);
  preparePhoto = preparePhoto;
  private editingClubId: string | null = null;

  activityForm = this.emptyActivity();
  eventForm = this.emptyEvent();
  clubForm = this.emptyClub();
  profileForm = {
    name: '',
    bio: '',
    location: '',
    visibility: 'private' as Visibility,
    sports: [] as Sport[],
  };

  private emptyActivity() {
    return {
      title: '',
      sport: 'Running' as Sport,
      occurredAt: localDate(new Date()),
      duration: 30,
      distance: null as number | null,
      notes: '',
      visibility: 'private' as Visibility,
    };
  }

  private emptyEvent() {
    const tomorrow = new Date(Date.now() + 86400_000);
    tomorrow.setHours(9, 0, 0, 0);
    return {
      title: '',
      sport: 'Running' as Sport,
      startsAt: localDate(tomorrow),
      location: '',
      description: '',
      level: 'All levels welcome',
      capacity: 12,
      conferenceName: '',
      conferenceUrl: '',
      clubId: '',
    };
  }

  private emptyClub() {
    return { name: '', description: '', sport: '' as Sport | '' };
  }

  /** Clubs an event can be linked to: joined clubs plus the event's current club. */
  eventClubOptions(): Club[] {
    return this.context.clubs().filter((club) => club.joined || club.id === this.eventForm.clubId);
  }

  openAtprotoLogin(): void {
    this.atprotoHandle = '';
    this.modal.set('atproto-login');
    this.context.show();
  }

  beginAtprotoLogin(): void {
    const handle = this.atprotoHandle.trim();
    if (!handle || handle.length > 253) {
      this.context.error.set('Enter a valid AT Protocol handle or DID.');
      return;
    }
    window.location.assign(`/auth/atproto?${new URLSearchParams({ handle })}`);
  }

  openModal(modal: Exclude<Modal, null>): void {
    if (!this.context.signedIn()) return;
    this.context.error.set('');
    this.context.notice.set('');
    this.publicDisclosure.set(false);
    if (modal === 'activity') {
      this.activityForm = this.emptyActivity();
      if (this.context.viewer()?.provider === 'atproto') this.activityForm.visibility = 'public';
      this.removePhoto();
    }
    if (modal === 'event') {
      this.eventForm = this.emptyEvent();
      this.editingEvent.set(null);
      this.editingClubId = null;
      const club = this.context.clubDetail()?.club;
      if (this.context.page() === 'clubs' && club?.joined) this.eventForm.clubId = club.id;
    }
    if (modal === 'club') {
      if (this.context.participation() !== 'ok') {
        this.context.error.set('Make your profile public to create a club.');
        return;
      }
      this.clubForm = this.emptyClub();
    }
    if (modal === 'profile') {
      const user = this.context.viewer()!;
      this.profileForm = {
        name: user.name,
        bio: user.bio,
        location: user.location,
        visibility: user.provider === 'atproto' ? 'public' : user.visibility,
        sports: [...user.sports],
      };
    }
    this.modal.set(modal);
    this.context.show();
  }

  makeProfilePublic(): void {
    this.openModal('profile');
    if (this.modal() === 'profile') this.profileForm.visibility = 'public';
  }

  closeModal(): void {
    if (this.context.saving()) return;
    this.context.close();
    this.modal.set(null);
    this.photoRequest++;
    this.photoBusy.set(false);
    this.removePhoto();
  }

  async choosePhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const requestId = ++this.photoRequest;
    this.context.error.set('');
    this.photoBusy.set(true);
    try {
      const photo = await this.preparePhoto(file);
      if (requestId !== this.photoRequest) return;
      this.removePhoto();
      this.photo.set(photo);
      this.photoPreview.set(URL.createObjectURL(photo));
    } catch (error) {
      if (requestId === this.photoRequest) this.context.error.set(this.message(error));
    } finally {
      if (requestId === this.photoRequest) this.photoBusy.set(false);
    }
  }

  removePhoto(): void {
    if (this.photoPreview()) URL.revokeObjectURL(this.photoPreview());
    this.photo.set(null);
    this.photoPreview.set('');
  }

  private async uploadPhoto(activityId: string, photo: Blob): Promise<void> {
    const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/photo`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': photo.type || 'image/jpeg' },
      body: photo,
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(result.error || 'The photo upload failed.');
    }
  }

  toggleSport(sport: Sport): void {
    this.profileForm.sports = this.profileForm.sports.includes(sport)
      ? this.profileForm.sports.filter((item) => item !== sport)
      : [...this.profileForm.sports, sport];
  }

  async save(): Promise<void> {
    if (this.context.saving()) return;
    if (
      this.context.viewer()?.provider === 'atproto' &&
      this.modal() !== 'club' &&
      !this.publicDisclosure()
    ) {
      this.context.error.set('Confirm that this will be publicly visible before saving.');
      return;
    }
    this.context.saving.set(true);
    this.context.error.set('');
    try {
      if (this.modal() === 'activity') {
        const { id } = await this.api<{ id: string }>('/api/activities', 'POST', {
          ...this.activityForm,
          occurredAt: new Date(this.activityForm.occurredAt).toISOString(),
        });
        const photo = this.photo();
        let photoError = '';
        if (photo) {
          try {
            await this.uploadPhoto(id, photo);
          } catch (error) {
            photoError = this.message(error);
          }
        }
        this.context.notice.set(
          photoError
            ? `Activity logged, but the photo didn’t upload: ${photoError}`
            : 'Activity logged. Every little move counts.',
        );
      } else if (this.modal() === 'event') {
        const conferenceName = this.eventForm.conferenceName.trim();
        const conferenceUrl = this.eventForm.conferenceUrl.trim();
        if (conferenceName.length > 100)
          throw new Error('Conference name must be at most 100 characters.');
        if (conferenceUrl && !conferenceName)
          throw new Error('Add a conference name for the conference URL.');
        if (conferenceUrl && !conferenceLink(conferenceUrl))
          throw new Error('Conference URL must be a safe HTTPS URL without credentials.');
        const editing = this.editingEvent();
        const { clubId, ...event } = this.eventForm;
        await this.api(
          editing ? `/api/events/${encodeURIComponent(editing)}` : '/api/events',
          editing ? 'PATCH' : 'POST',
          {
            ...event,
            ...(!editing || (clubId || null) !== this.editingClubId
              ? { clubId: clubId || null }
              : {}),
            conferenceName: conferenceName || null,
            conferenceUrl: conferenceUrl || null,
            startsAt: new Date(this.eventForm.startsAt).toISOString(),
          },
        );
        this.context.notice.set(
          editing
            ? 'Event updated. Everyone going will see the latest details.'
            : 'Event created. You are on the list as host.',
        );
        if (this.context.page() !== 'clubs') this.context.navigateEvents();
      } else if (this.modal() === 'club') {
        const { club } = await this.api<{ club: Club }>('/api/clubs', 'POST', {
          ...this.clubForm,
          sport: this.clubForm.sport || null,
        });
        this.context.notice.set(`${club.name} is ready. Invite your people.`);
        this.context.navigateToClub(club.slug);
      } else {
        await this.api('/api/me', 'PATCH', this.profileForm);
        this.context.notice.set('Profile updated. Your privacy, your call.');
      }
      await this.context.load();
      await this.context.refreshClub();
      this.context.saving.set(false);
      this.closeModal();
    } catch (error) {
      this.context.error.set(this.message(error));
    } finally {
      this.context.saving.set(false);
    }
  }

  editEvent(event: SportEvent): void {
    this.openModal('event');
    if (this.modal() !== 'event') return;
    this.editingEvent.set(event.id);
    this.eventForm = {
      title: event.title,
      sport: event.sport,
      startsAt: localDate(new Date(event.startsAt)),
      location: event.location,
      description: event.description,
      level: event.level,
      capacity: event.capacity,
      conferenceName: event.conferenceName ?? '',
      conferenceUrl: event.conferenceUrl ?? '',
      clubId: event.clubId ?? '',
    };
    this.editingClubId = event.clubId ?? null;
  }

  private api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    return request<T>(path, method, data);
  }

  private message(error: unknown): string {
    return errorMessage(error);
  }
}
