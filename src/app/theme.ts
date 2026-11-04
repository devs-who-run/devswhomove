import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly selected = signal<ThemePreference>(this.initialPreference());
  readonly preference = this.selected.asReadonly();

  constructor() {
    const onChange = () => this.apply();
    this.media.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', onChange));
    this.apply();
  }

  setPreference(preference: ThemePreference): void {
    this.selected.set(preference);
    this.apply();
    try {
      localStorage.setItem('dwm-theme', preference);
    } catch (error) {
      console.warn('Theme changed, but the preference could not be saved.', error);
    }
  }

  private initialPreference(): ThemePreference {
    const preference = this.document.documentElement.dataset['themePreference'];
    return preference === 'dark' || preference === 'light' ? preference : 'system';
  }

  private apply(): void {
    const preference = this.selected();
    const dark = preference === 'dark' || (preference === 'system' && this.media.matches);
    this.document.documentElement.dataset['themePreference'] = preference;
    this.document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
    this.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#111c17' : '#234d3c');
  }
}
