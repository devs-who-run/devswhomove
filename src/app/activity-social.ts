import { DatePipe } from '@angular/common';
import { Component, computed, input, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage, request } from './api';
import { Icon } from './icon';
import type { Activity, ActivityComment } from './models';

/** Who is looking at an activity, which decides whether they can give kudos or comment. */
export type Participation = 'anonymous' | 'private' | 'ok';

@Component({
  imports: [DatePipe, FormsModule, Icon, RouterLink],
  selector: 'app-activity-social',
  styleUrl: './activity-social.css',
  template: `
    <div class="social-bar">
      <button
        type="button"
        class="social-button"
        [class.active]="kudoed()"
        [attr.aria-pressed]="kudoed()"
        [disabled]="busy() || own()"
        [title]="own() ? 'You can’t give kudos to your own activity.' : ''"
        (click)="toggleKudos()"
      >
        <app-icon name="spark" />{{ kudos() }} kudos
      </button>
      <button
        type="button"
        class="social-button"
        [attr.aria-expanded]="open()"
        (click)="toggleComments()"
      >
        <app-icon name="people" />{{ commentCount() }}
        {{ commentCount() === 1 ? 'comment' : 'comments' }}
      </button>
    </div>
    @if (error()) {
      <p class="social-error" role="alert">{{ error() }}</p>
    }
    @if (open()) {
      <section class="comments" aria-label="Comments">
        @if (loading()) {
          <p class="social-muted" role="status">Loading comments…</p>
        } @else {
          <ul>
            @for (comment of comments(); track comment.id) {
              <li>
                <a
                  class="comment-author"
                  [routerLink]="[
                    '/profile',
                    comment.author.id.startsWith('did:')
                      ? comment.author.id
                      : comment.author.username,
                  ]"
                  >{{ comment.author.name }}</a
                >
                <span class="social-muted">{{ comment.createdAt | date: 'MMM d, h:mm a' }}</span>
                <p>{{ comment.body }}</p>
                @if (comment.canDelete) {
                  <button
                    type="button"
                    class="link-button danger"
                    [disabled]="busy()"
                    (click)="remove(comment)"
                  >
                    Delete
                  </button>
                }
              </li>
            } @empty {
              <li class="social-muted">No comments yet. Say something encouraging.</li>
            }
          </ul>
        }
        @if (participation() === 'ok') {
          <form class="comment-form" (ngSubmit)="add()">
            <label class="sr-only" [for]="'comment-' + activity().id">Add a comment</label>
            <input
              [id]="'comment-' + activity().id"
              name="comment"
              [(ngModel)]="draft"
              maxlength="500"
              placeholder="Cheer them on…"
              required
            />
            <button
              class="post-button"
              type="submit"
              [disabled]="busy() || loading() || !draft.trim()"
            >
              Post
            </button>
          </form>
        } @else {
          <p class="social-muted">{{ hint() }}</p>
        }
      </section>
    }
  `,
})
export class ActivitySocial {
  readonly activity = input.required<Activity>();
  readonly viewerId = input<string | null>(null);
  readonly participation = input<Participation>('anonymous');
  readonly kudos = linkedSignal(() => this.activity().kudos ?? 0);
  readonly kudoed = linkedSignal(() => !!this.activity().kudoed);
  readonly commentCount = linkedSignal(() => this.activity().comments ?? 0);
  readonly own = computed(() => this.activity().userId === this.viewerId());
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly comments = signal<ActivityComment[]>([]);
  readonly hint = computed(() =>
    this.participation() === 'private'
      ? 'Make your profile public to give kudos and comment.'
      : 'Sign in to give kudos and comment.',
  );
  draft = '';
  private loadRequest = 0;

  private path(suffix: string): string {
    return `/api/activities/${encodeURIComponent(this.activity().id)}/${suffix}`;
  }

  async toggleKudos(): Promise<void> {
    if (this.participation() !== 'ok' && !this.kudoed()) {
      this.error.set(this.hint());
      return;
    }
    await this.run(async () => {
      const result = await request<{ kudos: number; kudoed: boolean }>(this.path('kudos'), 'POST', {
        kudos: !this.kudoed(),
      });
      this.kudos.set(result.kudos);
      this.kudoed.set(result.kudoed);
    });
  }

  async toggleComments(): Promise<void> {
    this.open.update((open) => !open);
    if (!this.open()) return;
    const load = ++this.loadRequest;
    this.loading.set(true);
    this.error.set('');
    try {
      const { comments } = await request<{ comments: ActivityComment[] }>(this.path('comments'));
      if (load !== this.loadRequest) return;
      this.comments.set(comments);
      this.commentCount.set(comments.length);
    } catch (error) {
      if (load === this.loadRequest) this.error.set(errorMessage(error));
    } finally {
      if (load === this.loadRequest) this.loading.set(false);
    }
  }

  async add(): Promise<void> {
    const body = this.draft.trim();
    if (!body || this.loading()) return;
    await this.run(async () => {
      const { comment } = await request<{ comment: ActivityComment }>(
        this.path('comments'),
        'POST',
        { body },
      );
      this.invalidateLoad();
      this.comments.update((comments) => [...comments, comment]);
      this.commentCount.update((count) => count + 1);
      this.draft = '';
    });
  }

  async remove(comment: ActivityComment): Promise<void> {
    await this.run(async () => {
      await request(this.path(`comments/${encodeURIComponent(comment.id)}`), 'DELETE');
      this.invalidateLoad();
      this.comments.update((comments) => comments.filter((item) => item.id !== comment.id));
      this.commentCount.update((count) => Math.max(0, count - 1));
    });
  }

  /** Ignore a list fetch that started before a mutation, so it can't overwrite the result. */
  private invalidateLoad(): void {
    this.loadRequest++;
    this.loading.set(false);
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await work();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
