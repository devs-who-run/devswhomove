import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Icon } from './icon';
import { localDate } from './date';
import type { Activity, Profile } from './models';

const CHALLENGES = [
  {
    title: 'A walk around the block',
    prompt: 'Take a comfortable 10-minute walk.',
    gentle: 'A few minutes outside is plenty.',
  },
  {
    title: 'Find your rhythm',
    prompt: 'Try an easy run, walk, or cycle at your own pace.',
    gentle: 'A relaxed stroll counts.',
  },
  {
    title: 'Desk-to-door stretch',
    prompt: 'Give your shoulders, hips, and back a gentle reset.',
    gentle: 'Choose a few stretches that feel good.',
  },
  {
    title: 'Leg day, your way',
    prompt: 'Try a short strength session with bodyweight or weights.',
    gentle: 'A few sit-to-stands or stairs count.',
  },
  {
    title: 'Take the scenic route',
    prompt: 'Walk or ride somewhere you do not usually go.',
    gentle: 'One new street is an adventure.',
  },
  {
    title: 'Move to a beat',
    prompt: 'Put on a song and move for its whole length.',
    gentle: 'One song, seated or standing.',
  },
  {
    title: 'Recovery is training',
    prompt: 'Take a rest day or do a little gentle mobility.',
    gentle: 'Rest is a complete answer today.',
  },
  {
    title: 'A little more fresh air',
    prompt: 'Take a brisk walk or easy jog outside.',
    gentle: 'Step outdoors for a few minutes.',
  },
  {
    title: 'Upper-body reset',
    prompt: 'Try a few comfortable push, pull, or reach movements.',
    gentle: 'Shoulder rolls and wall push-ups count.',
  },
  {
    title: 'Pedal or stroll',
    prompt: 'Go for an easy bike ride or a purposeful walk.',
    gentle: 'Move for 10 minutes, at any pace.',
  },
  {
    title: 'Play a little',
    prompt: 'Find a ball, racket, or playful way to move.',
    gentle: 'A few minutes of play is enough.',
  },
  {
    title: 'Take the stairs',
    prompt: 'Add a few flights of stairs or a gentle hill.',
    gentle: 'One flight, or a flat walk, counts.',
  },
  {
    title: 'Mid-month reset',
    prompt: 'Choose any movement that helps you feel good.',
    gentle: 'A short stretch break is a win.',
  },
  {
    title: 'Rest and recharge',
    prompt: 'Rest, or make room for a little easy movement.',
    gentle: 'Rest counts. No workout required.',
  },
  {
    title: 'Try something different',
    prompt: 'Choose a sport or movement you have not done lately.',
    gentle: 'Five curious minutes is enough.',
  },
  {
    title: 'Core, softly',
    prompt: 'Try a few comfortable balance or core movements.',
    gentle: 'Standing balance or a seated twist counts.',
  },
  {
    title: 'Walk and wonder',
    prompt: 'Take a walk without a destination or pace goal.',
    gentle: 'A short wander counts.',
  },
  {
    title: 'Strength in small steps',
    prompt: 'Try a few strength movements that work for you.',
    gentle: 'One set, or a few gentle reps.',
  },
  {
    title: 'Move with a friend',
    prompt: 'Invite someone for a walk, ride, or active catch-up.',
    gentle: 'A phone call while strolling counts.',
  },
  {
    title: 'Choose your distance',
    prompt: 'Walk, run, or ride for a little while, not a target.',
    gentle: 'Turn around whenever you like.',
  },
  {
    title: 'Winter recovery',
    prompt: 'Take a rest day or enjoy gentle mobility.',
    gentle: 'Rest is the challenge today.',
  },
  {
    title: 'A short circuit',
    prompt: 'Mix a few easy strength and movement exercises.',
    gentle: 'Two movements are a whole circuit.',
  },
  {
    title: 'Fresh-air break',
    prompt: 'Step away from your screen for a comfortable walk.',
    gentle: 'A few minutes outside counts.',
  },
  {
    title: 'Your favorite move',
    prompt: 'Repeat the movement that felt best this month.',
    gentle: 'Keep it easy and make it yours.',
  },
  {
    title: 'Celebrate showing up',
    prompt: 'Choose any movement, or take the rest you need.',
    gentle: 'You made it here. That counts.',
  },
] as const;

interface AdventDay {
  day: number;
  date: string;
  dateLabel: string;
  title: string;
  prompt: string;
  gentle: string;
  open: boolean;
  restDay: boolean;
  activityCount: number;
  complete: boolean;
}

@Component({
  selector: 'app-advent-calendar',
  imports: [Icon],
  templateUrl: './advent-calendar.html',
  styleUrl: './advent-calendar.css',
})
export class AdventCalendar {
  readonly activities = input.required<Activity[]>();
  readonly viewer = input<Profile | null>(null);
  readonly loading = input(false);
  readonly error = input('');
  readonly logActivity = output<string>();
  readonly now = signal(new Date());
  readonly selectedDate = signal('');
  readonly restDates = signal<string[]>([]);
  readonly localError = signal('');
  readonly copied = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  readonly year = computed(() => this.now().getFullYear());

  readonly days = computed<AdventDay[]>(() => {
    const now = this.now();
    const today = localDate(now).slice(0, 10);
    const activityDates = new Map<string, number>();
    for (const activity of this.activities()) {
      const date = localDate(new Date(activity.occurredAt)).slice(0, 10);
      activityDates.set(date, (activityDates.get(date) ?? 0) + 1);
    }

    return CHALLENGES.map((challenge, index) => {
      const day = index + 1;
      const date = localDate(new Date(this.year(), 11, day)).slice(0, 10);
      const open = date <= today;
      const activityCount = open ? (activityDates.get(date) ?? 0) : 0;
      const restDay = day === 7 || day === 14 || day === 21 || day === 25;
      const complete = open && (activityCount > 0 || (restDay && this.restDates().includes(date)));
      return {
        day,
        date,
        dateLabel: new Date(this.year(), 11, day).toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
        }),
        title: challenge.title,
        prompt: challenge.prompt,
        gentle: challenge.gentle,
        open,
        restDay,
        activityCount,
        complete,
      };
    });
  });

  readonly unlockedDays = computed(() => this.days().filter((day) => day.open).length);
  readonly completedDays = computed(() => this.days().filter((day) => day.complete).length);
  readonly selectedDay = computed(() => {
    const days = this.days();
    const selected = days.find((day) => day.date === this.selectedDate());
    if (selected?.open) return selected;
    const today = localDate(this.now()).slice(0, 10);
    return (
      days.find((day) => day.date === today && day.open) ??
      [...days].reverse().find((day) => day.open) ??
      days[0]
    );
  });
  readonly seasonStatus = computed(() => {
    const now = this.now();
    const start = new Date(now.getFullYear(), 11, 1);
    const end = new Date(now.getFullYear(), 11, 25, 23, 59, 59, 999);
    if (now < start) return `The first door opens December 1, ${this.year()}.`;
    if (now > end) return `This year's calendar has ended. See you next December.`;
    return `Day ${now.getDate()} of 25`;
  });

  constructor() {
    effect(() => {
      const viewer = this.viewer();
      const year = this.year();
      this.restDates.set(viewer ? this.readRestDays(viewer.id, year) : []);
    });
    const updateAtMidnight = () => {
      const now = new Date();
      this.now.set(now);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timeout = window.setTimeout(updateAtMidnight, midnight.getTime() - now.getTime() + 10);
    };
    let timeout = window.setTimeout(
      updateAtMidnight,
      new Date(
        this.now().getFullYear(),
        this.now().getMonth(),
        this.now().getDate() + 1,
      ).getTime() -
        this.now().getTime() +
        10,
    );
    this.destroyRef.onDestroy(() => window.clearTimeout(timeout));
  }

  select(day: AdventDay): void {
    if (day.open) this.selectedDate.set(day.date);
  }

  toggleRestDay(day: AdventDay): void {
    const viewer = this.viewer();
    if (!viewer || !day.open || !day.restDay) return;
    const restDates = this.restDates();
    const next = restDates.includes(day.date)
      ? restDates.filter((date) => date !== day.date)
      : [...restDates, day.date];
    try {
      localStorage.setItem(this.storageKey(viewer.id, this.year()), JSON.stringify(next));
      this.restDates.set(next);
      this.localError.set('');
    } catch {
      this.localError.set('Your recovery check-in could not be saved in this browser.');
    }
  }

  async copyProgress(): Promise<void> {
    const message = `I completed ${this.completedDays()} of 25 days in the ${this.year()} Devs Who Move Advent Calendar. Every little move counts! ${window.location.origin}/advent`;
    try {
      await navigator.clipboard.writeText(message);
      this.copied.set(true);
      this.localError.set('');
    } catch {
      this.copied.set(false);
      this.localError.set(
        'Could not copy your progress. Please check clipboard access and try again.',
      );
    }
  }

  private storageKey(userId: string, year: number): string {
    return `devs-who-move:advent:${year}:${userId}`;
  }

  private readRestDays(userId: string, year: number): string[] {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(this.storageKey(userId, year)) ?? '[]',
      );
      if (!Array.isArray(parsed)) throw new Error('Invalid recovery check-ins.');
      const validDates = new Set(
        CHALLENGES.map((_, index) => localDate(new Date(year, 11, index + 1)).slice(0, 10)),
      );
      return parsed.filter(
        (date): date is string => typeof date === 'string' && validDates.has(date),
      );
    } catch {
      this.localError.set('Could not load recovery check-ins saved in this browser.');
      return [];
    }
  }
}
