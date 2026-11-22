import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { shareTargets } from './activity-share';
import type { PeriodRecap } from './insights.models';
import type { Profile } from './models';
import { completedMonths, monthLabel, wrappedPeriod } from './recap-period';

type Kind = PeriodRecap['kind'];

interface RecapState {
  data: PeriodRecap | null;
  loading: boolean;
  error: string;
  showCard: boolean;
  shareData: ShareData | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function isPeriodRecap(value: unknown): value is PeriodRecap {
  return (
    isRecord(value) &&
    (value['kind'] === 'monthly' || value['kind'] === 'wrapped') &&
    isRecord(value['period']) &&
    typeof value['period']['start'] === 'string' &&
    typeof value['period']['end'] === 'string' &&
    typeof value['partial'] === 'boolean' &&
    isRecord(value['totals']) &&
    isCount(value['totals']['sessions']) &&
    isCount(value['totals']['minutes']) &&
    isCount(value['totals']['distanceKm']) &&
    isCount(value['totals']['activeDays']) &&
    Array.isArray(value['totals']['bySport']) &&
    isCount(value['longestStreak']) &&
    (value['commits'] === null || isCount(value['commits'])) &&
    typeof value['coverage'] === 'string' &&
    typeof value['commitCoverage'] === 'string'
  );
}

/** Plain-text summary used for share posts, e.g. "1,200 public commits, 800 km". */
export function recapSummary(recap: PeriodRecap, label: string): string {
  const parts = [];
  if (recap.commits !== null) parts.push(`${recap.commits.toLocaleString('en-US')} public commits`);
  parts.push(`${recap.totals.distanceKm.toLocaleString('en-US', { maximumFractionDigits: 1 })} km`);
  parts.push(
    `${recap.totals.sessions.toLocaleString('en-US')} ${recap.totals.sessions === 1 ? 'session' : 'sessions'}`,
  );
  return `My ${label} on Devs Who Move: ${parts.join(', ')}.`;
}

const empty = (): RecapState => ({
  data: null,
  loading: false,
  error: '',
  showCard: false,
  shareData: null,
});

@Component({
  selector: 'app-period-recaps',
  imports: [DecimalPipe, FormsModule],
  templateUrl: './period-recaps.html',
  styleUrl: './period-recaps.css',
})
export class PeriodRecaps {
  readonly profile = input.required<Profile>();
  readonly months = completedMonths();
  readonly wrapped = wrappedPeriod();
  readonly canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;
  readonly kinds: Kind[] = this.wrapped ? ['wrapped', 'monthly'] : ['monthly'];
  readonly monthName = monthLabel;
  month = this.months[0];
  readonly state = { monthly: signal(empty()), wrapped: signal(empty()) };
  readonly shareError = signal('');
  readonly copied = signal<Kind | null>(null);
  private readonly controllers: Partial<Record<Kind, AbortController>> = {};
  readonly monthlyLabel = signal(monthLabel(this.months[0]));
  readonly wrappedLabel = computed(() =>
    this.wrapped ? `${this.wrapped.year} Wrapped${this.wrapped.partial ? ' so far' : ''}` : '',
  );

  constructor() {
    effect((onCleanup) => {
      this.profile();
      this.month = this.months[0];
      this.monthlyLabel.set(monthLabel(this.month));
      void this.load('monthly');
      if (this.wrapped) void this.load('wrapped');
      onCleanup(() => Object.values(this.controllers).forEach((controller) => controller?.abort()));
    });
  }

  query(kind: Kind): string {
    return kind === 'wrapped'
      ? 'type=wrapped'
      : `type=monthly&month=${encodeURIComponent(this.month)}`;
  }

  label(kind: Kind): string {
    return kind === 'wrapped' ? this.wrappedLabel() : `${this.monthlyLabel()} digest`;
  }

  cardUrl(kind: Kind): string {
    return `/api/insights/recap/card.png?${this.query(kind)}`;
  }

  fileName(kind: Kind): string {
    return `devs-who-move-${kind === 'wrapped' ? `${this.wrapped?.year}-wrapped` : `${this.month}-digest`}.png`;
  }

  targets(kind: Kind, recap: PeriodRecap) {
    return shareTargets(location.origin, recapSummary(recap, this.label(kind)));
  }

  selectMonth(month: string): void {
    this.month = month;
    this.monthlyLabel.set(monthLabel(month));
    void this.load('monthly');
  }

  async showCard(kind: Kind): Promise<void> {
    const recap = this.state[kind]().data;
    this.state[kind].update((state) => ({ ...state, showCard: true }));
    if (!this.canNativeShare || !recap) return;
    this.controllers[kind]?.abort();
    const controller = new AbortController();
    this.controllers[kind] = controller;
    this.shareError.set('');
    const data: ShareData = {
      title: this.label(kind),
      text: recapSummary(recap, this.label(kind)),
      url: location.origin,
    };
    const fileName = this.fileName(kind);
    try {
      const response = await fetch(this.cardUrl(kind), {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not load the card.');
      const file = new File([await response.blob()], fileName, { type: 'image/png' });
      const withFile = { ...data, files: [file] };
      if (!controller.signal.aborted)
        this.state[kind].update((state) => ({
          ...state,
          shareData: navigator.canShare?.(withFile) ? withFile : data,
        }));
    } catch {
      if (!controller.signal.aborted)
        this.shareError.set('Could not prepare sharing. Download the card instead.');
    }
  }

  async copySummary(kind: Kind, recap: PeriodRecap): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        `${recapSummary(recap, this.label(kind))} ${location.origin}`,
      );
      this.shareError.set('');
      this.copied.set(kind);
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      this.shareError.set('Could not copy the summary.');
    }
  }

  async nativeShare(kind: Kind): Promise<void> {
    const data = this.state[kind]().shareData;
    if (!data) {
      this.shareError.set('The card is not ready to share. Download the card instead.');
      return;
    }
    try {
      await navigator.share(data);
      this.shareError.set('');
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError')
        this.shareError.set('Sharing is not available here. Download the card instead.');
    }
  }

  async load(kind: Kind): Promise<void> {
    this.controllers[kind]?.abort();
    const controller = new AbortController();
    this.controllers[kind] = controller;
    this.state[kind].set({ ...empty(), loading: true });
    try {
      const response = await fetch(`/api/insights/recap?${this.query(kind)}`, {
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
      if (!isPeriodRecap(data)) throw new Error('Invalid recap response.');
      if (!controller.signal.aborted) this.state[kind].set({ ...empty(), data });
    } catch (error) {
      if (!controller.signal.aborted)
        this.state[kind].set({
          ...empty(),
          error: `Could not load your ${kind === 'wrapped' ? 'Wrapped' : 'monthly digest'}. ${error instanceof Error ? error.message : 'Please try again.'}`,
        });
    }
  }
}
