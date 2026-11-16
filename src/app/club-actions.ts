import { signal, type WritableSignal } from '@angular/core';
import { errorMessage, request } from './api';
import type { Participation } from './activity-social';
import type { Club, ClubDetail } from './models';

interface ClubActionsContext {
  routeRequest(): number;
  signedIn(): boolean;
  participation(): Participation;
  action(work: () => Promise<void>): Promise<void>;
  load(): Promise<void>;
  navigateToClubs(): void;
  error: WritableSignal<string>;
  notice: WritableSignal<string>;
}

export class ClubActions {
  readonly detail = signal<ClubDetail | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(private readonly context: ClubActionsContext) {}

  reset(): void {
    this.detail.set(null);
    this.error.set('');
    this.loading.set(false);
  }

  async load(requestId: number, slug: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await request<ClubDetail>(`/api/clubs/${encodeURIComponent(slug)}`);
      if (requestId === this.context.routeRequest()) this.detail.set(data);
    } catch (error) {
      if (requestId === this.context.routeRequest()) this.error.set(errorMessage(error));
    } finally {
      if (requestId === this.context.routeRequest()) this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    const slug = this.detail()?.club.slug;
    if (slug) await this.load(this.context.routeRequest(), slug);
  }

  async toggleMembership(club: Club): Promise<void> {
    if (!this.context.signedIn()) return;
    if (!club.joined && this.context.participation() !== 'ok') {
      this.context.error.set('Make your profile public to join clubs.');
      return;
    }
    await this.context.action(async () => {
      await request(`/api/clubs/${encodeURIComponent(club.slug)}/membership`, 'POST', {
        join: !club.joined,
      });
      await this.context.load();
      await this.refresh();
      this.context.notice.set(club.joined ? `You left ${club.name}.` : `Welcome to ${club.name}!`);
    });
  }

  async delete(club: Club): Promise<void> {
    if (!window.confirm(`Delete "${club.name}"? Its events stay public without the club label.`))
      return;
    await this.context.action(async () => {
      await request(`/api/clubs/${encodeURIComponent(club.slug)}`, 'DELETE');
      await this.context.load();
      this.context.notice.set('Club deleted.');
      this.context.navigateToClubs();
    });
  }

  async share(club: Club): Promise<void> {
    const url = new URL(`/clubs/${encodeURIComponent(club.slug)}`, window.location.origin).href;
    this.context.error.set('');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: club.name,
          text: `Join ${club.name} on Devs Who Move`,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      this.context.notice.set('Club invite link copied. Share it so people can join.');
    } catch {
      this.context.notice.set('');
      this.context.error.set(`Could not copy the club link. Copy it manually: ${url}`);
    }
  }
}
