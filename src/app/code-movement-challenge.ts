import { Component, computed, effect, input, signal } from '@angular/core';
import type { CodeMovementChallenge as Challenge } from './insights.models';
import type { Profile } from './models';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function isChallenge(value: unknown): value is Challenge {
  if (
    !isRecord(value) ||
    !isRecord(value['period']) ||
    typeof value['period']['start'] !== 'string' ||
    typeof value['period']['end'] !== 'string' ||
    typeof value['truncated'] !== 'boolean' ||
    !Array.isArray(value['days']) ||
    value['days'].length !== 30
  )
    return false;
  const start = Date.parse(`${value['period']['start']}T00:00:00Z`);
  if (!Number.isFinite(start)) return false;
  return (
    value['days'].every(
      (day: unknown, index: number) =>
        isRecord(day) &&
        day['date'] === new Date(start + index * 86_400_000).toISOString().slice(0, 10) &&
        typeof day['moved'] === 'boolean' &&
        typeof day['commitFound'] === 'boolean',
    ) && value['days'][29]['date'] === value['period']['end']
  );
}

@Component({
  selector: 'app-code-movement-challenge',
  templateUrl: './code-movement-challenge.html',
  styleUrl: './code-movement-challenge.css',
})
export class CodeMovementChallenge {
  readonly profile = input.required<Profile>();
  readonly data = signal<Challenge | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private controller?: AbortController;
  readonly confirmedStreak = computed(() => {
    const days = this.data()?.days ?? [];
    let index = days.length - 1;
    if (index >= 0 && !(days[index].moved && days[index].commitFound)) index--;
    let count = 0;
    while (index >= 0 && days[index].moved && days[index].commitFound) {
      count++;
      index--;
    }
    return count;
  });

  constructor() {
    effect((onCleanup) => {
      this.profile();
      this.data.set(null);
      this.error.set('');
      this.loading.set(false);
      onCleanup(() => this.controller?.abort());
    });
  }

  async load(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.loading.set(true);
    this.error.set('');
    this.data.set(null);
    try {
      const response = await fetch('/api/insights/code-movement', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(
          isRecord(body) && typeof body['error'] === 'string' ? body['error'] : 'Please try again.',
        );
      }
      const result: unknown = await response.json();
      if (!isChallenge(result)) throw new Error('Invalid challenge response.');
      if (!controller.signal.aborted) this.data.set(result);
    } catch (error) {
      if (!controller.signal.aborted)
        this.error.set(
          `Could not load your challenge. ${error instanceof Error ? error.message : 'Please try again.'}`,
        );
    } finally {
      if (!controller.signal.aborted) this.loading.set(false);
    }
  }
}
