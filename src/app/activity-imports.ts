import { SlicePipe } from '@angular/common';
import { Component, OnInit, input, output, signal } from '@angular/core';
import type { Profile } from './models';
import { errorMessage, request } from './api';
import {
  parseImportFile,
  type FileImportSource,
  type ParsedActivity,
} from './activity-import-parsers';

interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athleteId?: number;
  historyComplete?: boolean;
  lastSyncedAt?: string | null;
}

interface ImportCounts {
  imported: number;
  duplicates: number;
  invalid: number;
}

interface StravaSync extends ImportCounts {
  historyComplete: boolean;
  lastSyncedAt: string;
}

const BATCH = 200;
/** Each sync call reads up to 600 Strava activities; stop before Strava's 15-minute limit. */
const MAX_SYNC_ROUNDS = 25;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

@Component({
  selector: 'app-activity-imports',
  styleUrl: './activity-imports.css',
  template: `
    <section class="activity-imports" aria-labelledby="imports-title">
      <div>
        <h2 id="imports-title">Import activities</h2>
        <p>
          Bring in workouts from Strava, Garmin and Apple Health. Imports are private, keep only the
          sport, start time, duration and distance, and skip workouts you already have.
        </p>
      </div>

      @if (profile().provider === 'atproto') {
        <p class="note">
          Importing is available for GitHub accounts. AT Protocol activities are public records, so
          workout and health imports are not written to your PDS.
        </p>
      } @else {
        <div class="import-sources">
          <article class="import-source" aria-labelledby="strava-title">
            <h3 id="strava-title">Strava</h3>
            @if (!strava()) {
              <p>Checking your Strava connection…</p>
            } @else if (!strava()!.configured) {
              <p>Strava sync is not set up on this server yet.</p>
            } @else if (strava()!.connected) {
              <p>
                Connected. New Strava activities arrive automatically.
                @if (strava()!.lastSyncedAt) {
                  Last synced {{ strava()!.lastSyncedAt | slice: 0 : 10 }}.
                }
              </p>
              <div class="import-actions">
                <button class="button" type="button" [disabled]="busy()" (click)="syncStrava()">
                  {{
                    syncing()
                      ? 'Syncing…'
                      : strava()!.historyComplete
                        ? 'Sync now'
                        : 'Import Strava history'
                  }}
                </button>
                <button
                  class="button outline"
                  type="button"
                  [disabled]="busy()"
                  (click)="disconnectStrava()"
                >
                  Disconnect
                </button>
              </div>
            } @else {
              <p>Connect once to import your history and every new activity.</p>
              <div class="import-actions">
                <a class="button strava" href="/auth/strava">Connect with Strava</a>
              </div>
            }
            <p class="fine-print">
              Strava’s API terms only allow showing Strava data to you, so Strava imports stay
              private.
            </p>
          </article>

          <article class="import-source" aria-labelledby="files-title">
            <h3 id="files-title">Garmin, Apple Health and files</h3>
            <ul>
              <li>
                <strong>Garmin Connect:</strong> open an activity, choose ⚙ → Export Original, or
                request your full data export from your Garmin account.
              </li>
              <li>
                <strong>Apple Health:</strong> in the Health app, tap your picture → Export All
                Health Data, then choose the export.zip here.
              </li>
              <li>Also accepts .fit, .gpx and .tcx files from any watch or app.</li>
            </ul>
            <label class="button outline file-button" [class.disabled]="busy()">
              Choose files
              <input
                type="file"
                multiple
                accept=".zip,.fit,.gpx,.tcx,.xml,.gz"
                [disabled]="busy()"
                (change)="importFiles($event)"
              />
            </label>
            <p class="fine-print">
              Files are read on this device. GPS routes, heart rate and other health data are never
              uploaded.
            </p>
          </article>
        </div>
      }

      @if (status()) {
        <p class="status" role="status">{{ status() }}</p>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
  imports: [SlicePipe],
})
export class ActivityImports implements OnInit {
  readonly profile = input.required<Profile>();
  readonly imported = output<void>();
  readonly strava = signal<StravaStatus | null>(null);
  readonly syncing = signal(false);
  readonly reading = signal(false);
  readonly status = signal('');
  readonly error = signal('');

  busy(): boolean {
    return this.syncing() || this.reading();
  }

  async ngOnInit(): Promise<void> {
    if (this.profile().provider === 'atproto') return;
    const params = new URLSearchParams(location.search);
    const outcome = params.get('strava');
    const reason = params.get('reason');
    if (outcome) {
      params.delete('strava');
      params.delete('reason');
      const query = params.toString();
      history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}`);
    }
    try {
      this.strava.set(await request<StravaStatus>('/api/strava'));
    } catch (error) {
      this.strava.set({ configured: false, connected: false });
      this.error.set(errorMessage(error));
    }
    if (outcome === 'connected') await this.syncStrava();
    else if (outcome === 'denied') this.error.set('Strava access was not approved.');
    else if (outcome === 'error')
      this.error.set(reason || 'Strava could not be connected. Please try again.');
  }

  async syncStrava(): Promise<void> {
    if (this.busy()) return;
    this.syncing.set(true);
    this.error.set('');
    const totals: ImportCounts = { imported: 0, duplicates: 0, invalid: 0 };
    try {
      for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
        const result = await request<StravaSync>('/api/strava/sync', 'POST');
        totals.imported += result.imported;
        totals.duplicates += result.duplicates;
        totals.invalid += result.invalid;
        this.strava.update((current) => ({
          ...(current ?? { configured: true, connected: true }),
          historyComplete: result.historyComplete,
          lastSyncedAt: result.lastSyncedAt,
        }));
        this.status.set(`Strava: ${this.summary(totals)}${result.historyComplete ? '' : '…'}`);
        if (result.historyComplete) break;
      }
    } catch (error) {
      this.error.set(errorMessage(error));
      this.strava.set(await request<StravaStatus>('/api/strava').catch(() => this.strava()));
    } finally {
      this.syncing.set(false);
      // Refresh lists after a full or partial sync, once.
      if (totals.imported) this.imported.emit();
    }
  }

  async disconnectStrava(): Promise<void> {
    if (this.busy()) return;
    this.error.set('');
    try {
      await request('/api/strava', 'DELETE');
      this.strava.set({ configured: true, connected: false });
      this.status.set('Strava disconnected. Activities you already imported stay on your profile.');
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }

  async importFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length || this.busy()) return;
    this.reading.set(true);
    this.error.set('');
    const totals: ImportCounts = { imported: 0, duplicates: 0, invalid: 0 };
    const found: ParsedActivity[] = [];
    let skipped = 0;
    try {
      for (const file of files) {
        this.status.set(`Reading ${file.name}…`);
        const result = await parseImportFile(file, (message) => this.status.set(message));
        found.push(...result.activities);
        skipped += result.skipped;
      }
      if (!found.length) {
        this.status.set('');
        this.error.set('No workouts were found in the selected files.');
        return;
      }
      const bySource = new Map<FileImportSource, ParsedActivity[]>();
      for (const activity of found) {
        const bucket = bySource.get(activity.source);
        if (bucket) bucket.push(activity);
        else bySource.set(activity.source, [activity]);
      }
      let sent = 0;
      for (const [source, activities] of bySource) {
        for (let offset = 0; offset < activities.length; offset += BATCH) {
          this.status.set(
            `Importing ${sent.toLocaleString()} of ${plural(found.length, 'workout')}…`,
          );
          const batch = activities
            .slice(offset, offset + BATCH)
            .map(({ source: _source, ...activity }) => activity);
          const result = await request<ImportCounts>('/api/imports', 'POST', {
            source,
            activities: batch,
          });
          totals.imported += result.imported;
          totals.duplicates += result.duplicates;
          totals.invalid += result.invalid;
          sent += batch.length;
        }
      }
      totals.invalid += skipped;
      this.status.set(this.summary(totals));
      if (totals.imported) this.imported.emit();
    } catch (error) {
      this.error.set(errorMessage(error));
      if (totals.imported) {
        this.status.set(`Stopped after ${this.summary(totals)}`);
        this.imported.emit();
      } else this.status.set('');
    } finally {
      this.reading.set(false);
    }
  }

  private summary({ imported, duplicates, invalid }: ImportCounts): string {
    const parts = [`Imported ${plural(imported, 'activity', 'activities')}`];
    if (duplicates) parts.push(`${duplicates.toLocaleString()} already on your profile`);
    if (invalid) parts.push(`${invalid.toLocaleString()} skipped (under a minute or over a day)`);
    return `${parts.join(', ')}.`;
  }
}
