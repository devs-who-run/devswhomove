import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Profile } from './models';
import { errorMessage, request } from './api';

@Component({
  imports: [FormsModule],
  selector: 'app-account-settings',
  styleUrl: './account-settings.css',
  template: `
    <section class="account-settings" aria-labelledby="account-settings-title">
      <div>
        <h2 id="account-settings-title">Your account</h2>
        <p>Take a copy of your data or permanently delete your account.</p>
      </div>
      <div class="account-actions">
        <a class="button outline" href="/api/account/export">Download your data</a>
        <button class="button danger" type="button" (click)="openDeleteDialog()">
          Delete account
        </button>
      </div>
    </section>

    <dialog #deleteDialog aria-labelledby="delete-title">
      <form (submit)="$event.preventDefault(); deleteAccount()">
        <h2 id="delete-title">Delete your account?</h2>
        <p>
          This permanently removes your profile, activities, events, photos, tokens, and social data
          from Devs Who Move.
        </p>
        @if (profile().provider === 'atproto') {
          <p>
            Your Devs Who Move public records will be deleted from your PDS. Your Bluesky profile
            stays intact. Copies already made by other services cannot be recalled.
          </p>
        }
        <label for="delete-confirmation">Type DELETE to confirm</label>
        <input
          id="delete-confirmation"
          name="confirmation"
          autocomplete="off"
          [(ngModel)]="confirmation"
        />
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <div class="dialog-actions">
          <button
            class="button outline"
            type="button"
            [disabled]="deleting()"
            (click)="closeDeleteDialog()"
          >
            Cancel
          </button>
          <button
            class="button danger"
            type="submit"
            [disabled]="deleting() || confirmation !== 'DELETE'"
          >
            {{ deleting() ? 'Deleting…' : 'Permanently delete' }}
          </button>
        </div>
      </form>
    </dialog>
  `,
})
export class AccountSettings {
  readonly profile = input.required<Profile>();
  readonly deleted = output<void>();
  readonly deleting = signal(false);
  readonly error = signal('');
  confirmation = '';

  openDeleteDialog(): void {
    this.confirmation = '';
    this.error.set('');
    document.querySelector<HTMLDialogElement>('app-account-settings dialog')?.showModal();
  }

  closeDeleteDialog(): void {
    document.querySelector<HTMLDialogElement>('app-account-settings dialog')?.close();
  }

  async deleteAccount(): Promise<void> {
    if (this.confirmation !== 'DELETE' || this.deleting()) return;
    this.deleting.set(true);
    this.error.set('');
    try {
      await request('/api/account', 'DELETE', { confirmation: this.confirmation });
      this.closeDeleteDialog();
      this.deleted.emit();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.deleting.set(false);
    }
  }
}
