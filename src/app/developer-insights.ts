import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, input, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import type { GithubInsights, WeeklyRecap } from './insights.models';
import type { Profile } from './models';

interface Resource<T> {
  owner: string;
  data: T | null;
  loading: boolean;
  error: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isPeriod = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value['start'] === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value['start']) &&
  typeof value['end'] === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value['end']);
const isTotals = (value: unknown): boolean =>
  isRecord(value) &&
  isCount(value['sessions']) &&
  isCount(value['minutes']) &&
  isCount(value['distanceKm']);
const isActivityTotals = (value: unknown): boolean =>
  isRecord(value) &&
  isTotals(value) &&
  isCount(value['activeDays']) &&
  Array.isArray(value['bySport']) &&
  value['bySport'].every(
    (sport: unknown) => isRecord(sport) && typeof sport['sport'] === 'string' && isTotals(sport),
  );
const isWeeklyRecap = (value: unknown): value is WeeklyRecap =>
  isRecord(value) &&
  isPeriod(value['period']) &&
  isPeriod(value['previousPeriod']) &&
  isActivityTotals(value['current']) &&
  isActivityTotals(value['previous']) &&
  typeof value['summary'] === 'string' &&
  typeof value['coverage'] === 'string';
const isGithubInsights = (value: unknown): value is GithubInsights =>
  isRecord(value) &&
  isPeriod(value['period']) &&
  isCount(value['pushEvents']) &&
  (value['commits'] === null || isCount(value['commits'])) &&
  typeof value['complete'] === 'boolean' &&
  typeof value['username'] === 'string' &&
  typeof value['coverage'] === 'string';

@Component({
  selector: 'app-developer-insights',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './developer-insights.html',
  styleUrl: './developer-insights.css',
})
export class DeveloperInsights {
  readonly profile = input.required<Profile>();
  readonly isGithub = computed(() => this.profile().provider !== 'atproto');
  private readonly owner = computed(
    () => `${this.profile().provider ?? 'github'}:${this.profile().id}:${this.profile().username}`,
  );
  private readonly weeklyResource = signal<Resource<WeeklyRecap>>(this.empty(''));
  private readonly githubResource = signal<Resource<GithubInsights>>(this.empty(''));
  readonly weekly = computed(() => this.forCurrentOwner(this.weeklyResource()));
  readonly github = computed(() => this.forCurrentOwner(this.githubResource()));
  readonly agentExample = '{"name":"get_weekly_recap","arguments":{}}';
  private weeklyController?: AbortController;
  private githubController?: AbortController;

  constructor() {
    effect((onCleanup) => {
      this.profile();
      this.weeklyResource.set(this.empty(this.owner()));
      this.githubResource.set(this.empty(this.owner()));
      void this.retryWeekly();
      if (this.isGithub()) void this.retryGithub();
      onCleanup(() => {
        this.weeklyController?.abort();
        this.githubController?.abort();
      });
    });
  }

  async retryWeekly(): Promise<void> {
    this.weeklyController?.abort();
    const controller = new AbortController();
    this.weeklyController = controller;
    await this.load(
      '/api/insights/weekly',
      this.weeklyResource,
      controller,
      'weekly recap',
      isWeeklyRecap,
    );
  }

  async retryGithub(): Promise<void> {
    if (!this.isGithub()) return;
    this.githubController?.abort();
    const controller = new AbortController();
    this.githubController = controller;
    await this.load(
      '/api/insights/github',
      this.githubResource,
      controller,
      'GitHub comparison',
      isGithubInsights,
    );
  }

  delta(current: number, previous: number, unit: string, plural = `${unit}s`): string {
    const difference = Math.round((current - previous) * 100) / 100;
    if (difference === 0) return `No change in ${plural}`;
    return `${difference > 0 ? '+' : '−'}${Math.abs(difference)} ${Math.abs(difference) === 1 ? unit : plural}`;
  }

  private empty<T>(owner: string): Resource<T> {
    return { owner, data: null, loading: true, error: '' };
  }

  private forCurrentOwner<T>(resource: Resource<T>): Resource<T> {
    return resource.owner === this.owner() ? resource : this.empty(this.owner());
  }

  private async load<T>(
    path: string,
    resource: WritableSignal<Resource<T>>,
    controller: AbortController,
    label: string,
    validate: (value: unknown) => value is T,
  ): Promise<void> {
    const owner = this.owner();
    resource.set(this.empty(owner));
    try {
      const response = await fetch(path, {
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
      const data: unknown = await response.json();
      if (!validate(data)) throw new Error('Invalid insights response');
      if (!controller.signal.aborted && owner === this.owner()) {
        resource.set({ owner, data, loading: false, error: '' });
      }
    } catch (error) {
      if (!controller.signal.aborted && owner === this.owner()) {
        resource.set({
          owner,
          data: null,
          loading: false,
          error: `Could not load your ${label}. ${error instanceof Error ? error.message : 'Please try again.'}`,
        });
      }
    }
  }
}
