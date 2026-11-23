import { Component, computed, input } from '@angular/core';
import { Icon } from './icon';
import type { Activity } from './models';

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
  /** Progress towards the badge, capped at the target. */
  progress: number;
  target: number;
}

interface BadgeStats {
  sessions: number;
  longestRun: number;
  cyclingKm: number;
  longestStreak: number;
  longestWeekStreak: number;
  sports: number;
  agentSessions: number;
  earlySessions: number;
  lateSessions: number;
}

interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  target: number;
  value: (stats: BadgeStats) => number;
}

const DAY = 86_400_000;

const DEFINITIONS: BadgeDefinition[] = [
  {
    id: 'first-move',
    name: 'First move',
    description: 'Log your first activity.',
    icon: 'brand',
    target: 1,
    value: (s) => s.sessions,
  },
  {
    id: 'sessions-10',
    name: 'Warmed up',
    description: 'Log 10 activities.',
    icon: 'spark',
    target: 10,
    value: (s) => s.sessions,
  },
  {
    id: 'sessions-50',
    name: 'Habit formed',
    description: 'Log 50 activities.',
    icon: 'spark',
    target: 50,
    value: (s) => s.sessions,
  },
  {
    id: 'sessions-100',
    name: 'Centurion',
    description: 'Log 100 activities.',
    icon: 'spark',
    target: 100,
    value: (s) => s.sessions,
  },
  {
    id: 'run-5k',
    name: '5K',
    description: 'Run 5 km in a single activity.',
    icon: 'Running',
    target: 5,
    value: (s) => s.longestRun,
  },
  {
    id: 'run-10k',
    name: '10K',
    description: 'Run 10 km in a single activity.',
    icon: 'Running',
    target: 10,
    value: (s) => s.longestRun,
  },
  {
    id: 'run-half',
    name: 'Half marathon',
    description: 'Run 21.1 km in a single activity.',
    icon: 'Running',
    target: 21.0975,
    value: (s) => s.longestRun,
  },
  {
    id: 'run-marathon',
    name: 'Marathon',
    description: 'Run 42.2 km in a single activity.',
    icon: 'Running',
    target: 42.195,
    value: (s) => s.longestRun,
  },
  {
    id: 'cycling-100',
    name: 'Century rider',
    description: 'Ride 100 km in total.',
    icon: 'Cycling',
    target: 100,
    value: (s) => s.cyclingKm,
  },
  {
    id: 'streak-3',
    name: 'On a roll',
    description: 'Move 3 days in a row.',
    icon: 'calendar',
    target: 3,
    value: (s) => s.longestStreak,
  },
  {
    id: 'streak-7',
    name: 'Week warrior',
    description: 'Move 7 days in a row.',
    icon: 'calendar',
    target: 7,
    value: (s) => s.longestStreak,
  },
  {
    id: 'weeks-4',
    name: 'Consistent',
    description: 'Move at least once a week for 4 weeks in a row.',
    icon: 'clock',
    target: 4,
    value: (s) => s.longestWeekStreak,
  },
  {
    id: 'variety-3',
    name: 'All-rounder',
    description: 'Log 3 different sports.',
    icon: 'grid',
    target: 3,
    value: (s) => s.sports,
  },
  {
    id: 'agent',
    name: 'Automated athlete',
    description: 'Log an activity through an agent.',
    icon: 'terminal',
    target: 1,
    value: (s) => s.agentSessions,
  },
  {
    id: 'early-bird',
    name: 'Early bird',
    description: 'Start an activity before 7 am.',
    icon: 'sun',
    target: 1,
    value: (s) => s.earlySessions,
  },
  {
    id: 'night-owl',
    name: 'Night owl',
    description: 'Start an activity at 9 pm or later.',
    icon: 'moon',
    target: 1,
    value: (s) => s.lateSessions,
  },
];

/** Local calendar day as a whole number of days since the epoch. */
const dayNumber = (date: Date) =>
  Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);

function longestConsecutive(values: Iterable<number>): number {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  sorted.forEach((value, index) => {
    current = index > 0 && value === sorted[index - 1] + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  });
  return longest;
}

function badgeStats(activities: Activity[]): BadgeStats {
  const days: number[] = [];
  let longestRun = 0;
  let cyclingKm = 0;
  let agentSessions = 0;
  let earlySessions = 0;
  let lateSessions = 0;
  for (const activity of activities) {
    const date = new Date(activity.occurredAt);
    if (Number.isNaN(date.getTime())) continue;
    days.push(dayNumber(date));
    if (activity.sport === 'Running') longestRun = Math.max(longestRun, activity.distance ?? 0);
    if (activity.sport === 'Cycling') cyclingKm += activity.distance ?? 0;
    if (activity.source === 'agent') agentSessions++;
    if (date.getHours() < 7) earlySessions++;
    if (date.getHours() >= 21) lateSessions++;
  }
  // Day 0 (1 Jan 1970) was a Thursday; shift by 3 so weeks start on Monday.
  const weeks = days.map((day) => Math.floor((day + 3) / 7));
  return {
    sessions: activities.length,
    longestRun,
    cyclingKm,
    longestStreak: longestConsecutive(days),
    longestWeekStreak: longestConsecutive(weeks),
    sports: new Set(activities.map((activity) => activity.sport)).size,
    agentSessions,
    earlySessions,
    lateSessions,
  };
}

/** Badges are derived from activities in the viewer's local time zone. */
export function computeBadges(activities: Activity[]): Badge[] {
  const stats = badgeStats(activities);
  return DEFINITIONS.map(({ value, ...definition }) => {
    const progress = Math.min(value(stats), definition.target);
    return { ...definition, progress, earned: progress >= definition.target };
  });
}

@Component({
  imports: [Icon],
  selector: 'app-profile-badges',
  styleUrl: './badges.css',
  template: `
    <section class="badges" aria-labelledby="badges-title">
      <header>
        <h2 id="badges-title">Badges</h2>
        <span class="badge-count">{{ earnedCount() }} of {{ badges().length }} earned</span>
      </header>
      <ul>
        @for (badge of badges(); track badge.id) {
          <li
            class="badge"
            [class.earned]="badge.earned"
            [attr.aria-label]="
              badge.name + (badge.earned ? ', earned. ' : ', not earned yet. ') + badge.description
            "
          >
            <span class="badge-icon"><app-icon [name]="badge.icon" /></span>
            <strong>{{ badge.name }}</strong>
            <small>{{ badge.description }}</small>
            @if (!badge.earned && badge.target > 1) {
              <span
                class="badge-progress"
                role="progressbar"
                aria-label="Progress"
                [attr.aria-valuenow]="badge.progress"
                aria-valuemin="0"
                [attr.aria-valuemax]="badge.target"
                ><span [style.width.%]="(badge.progress / badge.target) * 100"></span
              ></span>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class ProfileBadges {
  readonly activities = input.required<Activity[]>();
  readonly badges = computed(() => computeBadges(this.activities()));
  readonly earnedCount = computed(() => this.badges().filter((badge) => badge.earned).length);
}
