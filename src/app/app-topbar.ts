import { Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';
import { Login } from './login';
import type { Profile } from './models';
import { Theme, type ThemePreference } from './theme';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: string;
}

export type Page =
  'feed' | 'explore' | 'events' | 'clubs' | 'profile' | 'agents' | 'activity' | 'advent';

export interface NavItem {
  page: Page;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-topbar',
  imports: [Icon, Login, RouterLink],
  templateUrl: './app-topbar.html',
  styleUrls: ['./page-layout.css', './app-topbar.css'],
  host: {
    '(document:click)': 'closeMenuOnOutsideClick($event)',
    '(document:keydown.escape)': 'closeMenu(true)',
  },
})
export class AppTopbar {
  readonly theme = inject(Theme);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly nav = input.required<NavItem[]>();
  readonly page = input.required<Page>();
  readonly viewer = input<Profile | null>(null);
  readonly saving = input(false);
  readonly githubLogin = output<void>();
  readonly atprotoLogin = output<void>();
  readonly signOut = output<void>();
  readonly logActivity = output<void>();

  readonly themes: readonly ThemeOption[] = [
    { value: 'light', label: 'Light theme', icon: 'sun' },
    { value: 'system', label: 'Match system theme', icon: 'monitor' },
    { value: 'dark', label: 'Dark theme', icon: 'moon' },
  ];
  readonly themeIndex = computed(() =>
    this.themes.findIndex((option) => option.value === this.theme.preference()),
  );
  readonly currentTheme = computed(() => this.themes[this.themeIndex()]);
  readonly nextTheme = computed(() => this.themes[(this.themeIndex() + 1) % this.themes.length]);

  readonly menuOpen = signal(false);
  readonly firstName = computed(() => this.viewer()?.name.split(' ')[0] || '');
  /** The mobile tab bar puts "Log activity" between the first and second halves of the nav. */
  readonly tabsBefore = computed(() => this.nav().slice(0, Math.ceil(this.nav().length / 2)));
  readonly tabsAfter = computed(() => this.nav().slice(Math.ceil(this.nav().length / 2)));

  initials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  /** Arrow keys move the selection within the radio group, as native radios do. */
  moveTheme(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? this.themes.length - 1
          : step
            ? (this.themeIndex() + step + this.themes.length) % this.themes.length
            : -1;
    if (index < 0) return;
    event.preventDefault();
    this.theme.setPreference(this.themes[index].value);
    const group = (event.currentTarget as HTMLElement).parentElement;
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  closeMenu(restoreFocus = false): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    if (restoreFocus)
      this.host.nativeElement.querySelector<HTMLButtonElement>('.account-button')?.focus();
  }

  closeMenuOnOutsideClick(event: Event): void {
    const menu = this.host.nativeElement.querySelector('.account');
    if (menu && !menu.contains(event.target as Node)) this.closeMenu();
  }
}
