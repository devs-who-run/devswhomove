import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Icon } from './icon';
import type { Activity } from './models';

const MASTODON_KEY = 'dwm.mastodonInstance';
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export interface ShareTarget {
  name: string;
  href: string;
}

/** Share intents for networks that accept a prefilled post or URL. */
export function shareTargets(url: string, text: string): ShareTarget[] {
  const u = encodeURIComponent(url);
  const withUrl = encodeURIComponent(`${text} ${url}`);
  return [
    { name: 'X', href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${u}` },
    { name: 'Bluesky', href: `https://bsky.app/intent/compose?text=${withUrl}` },
    { name: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: 'Threads', href: `https://www.threads.net/intent/post?text=${withUrl}` },
  ];
}

/** Normalises user input like `https://mastodon.social/` to a bare hostname, or '' if invalid. */
export function mastodonHost(value: string): string {
  const host = value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^@?[^@/]*@/, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  return HOSTNAME.test(host) ? host : '';
}

function storedInstance(): string {
  try {
    return localStorage.getItem(MASTODON_KEY) ?? '';
  } catch {
    return '';
  }
}

@Component({
  imports: [FormsModule, Icon],
  selector: 'app-activity-share',
  styleUrl: './activity-share.css',
  template: `
    <section class="share-panel" aria-label="Share activity">
      <img
        class="share-preview"
        [src]="cardUrl()"
        [alt]="'Share card for ' + activity().title"
        width="1200"
        height="630"
        loading="lazy"
      />
      <div class="share-targets">
        @for (target of targets(); track target.name) {
          <a class="share-target" [href]="target.href" target="_blank" rel="noopener noreferrer">{{
            target.name
          }}</a>
        }
      </div>
      <form class="mastodon-form" (ngSubmit)="shareMastodon()">
        <label [for]="'mastodon-' + activity().id">Mastodon</label>
        <input
          [id]="'mastodon-' + activity().id"
          name="instance"
          [(ngModel)]="instance"
          placeholder="mastodon.social"
          autocomplete="off"
          spellcheck="false"
        />
        <button type="submit" class="share-target">Share</button>
      </form>
      <div class="share-actions">
        <button type="button" class="share-action" (click)="copy()">
          <app-icon name="link" />{{ copied() ? 'Copied' : 'Copy link' }}
        </button>
        <a class="share-action" [href]="cardUrl()" [download]="fileName()"
          ><app-icon name="download" />Download image</a
        >
        @if (canNativeShare) {
          <button type="button" class="share-action" (click)="nativeShare()">
            <app-icon name="share" />More…
          </button>
        }
      </div>
      @if (error()) {
        <p class="share-error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
})
export class ActivityShare {
  readonly activity = input.required<Activity>();
  readonly copied = signal(false);
  readonly error = signal('');
  readonly canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;
  instance = storedInstance();

  readonly url = computed(
    () => `${location.origin}/activities/${encodeURIComponent(this.activity().id)}`,
  );
  readonly cardUrl = computed(
    () => `/api/activities/${encodeURIComponent(this.activity().id)}/card.png`,
  );
  readonly text = computed(
    () => `${this.activity().title} · ${this.activity().sport} on Devs Who Move`,
  );
  readonly targets = computed(() => shareTargets(this.url(), this.text()));
  readonly fileName = computed(
    () =>
      `devs-who-move-${
        this.activity()
          .title.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48) || 'activity'
      }.png`,
  );

  shareMastodon(): void {
    const host = mastodonHost(this.instance);
    if (!host) {
      this.error.set('Enter your Mastodon server, for example mastodon.social.');
      return;
    }
    this.error.set('');
    this.instance = host;
    try {
      localStorage.setItem(MASTODON_KEY, host);
    } catch {
      // Storage can be unavailable in private browsing; sharing still works.
    }
    window.open(
      `https://${host}/share?text=${encodeURIComponent(`${this.text()} ${this.url()}`)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url());
      this.error.set('');
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.error.set('Could not copy the link. Copy it from the address bar instead.');
    }
  }

  async nativeShare(): Promise<void> {
    try {
      await navigator.share({ title: this.activity().title, text: this.text(), url: this.url() });
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') this.error.set('Sharing is not available here.');
    }
  }
}
