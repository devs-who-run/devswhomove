import { Injectable, signal, effect, inject, DOCUMENT } from '@angular/core';

import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  isDarkMode = signal(false);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      try {
        if (window.matchMedia) {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
          this.isDarkMode.set(mediaQuery.matches);

          mediaQuery.addEventListener('change', (e) => {
            this.isDarkMode.set(e.matches);
            this.updateDocumentClass();
          });
        }
      } catch (err) {
        console.warn('matchMedia not available in this environment:', err);
      }
    }

    effect(() => {
      this.updateDocumentClass();
    });
  }

  toggleTheme() {
    this.isDarkMode.update((value) => !value);
  }

  private updateDocumentClass() {
    if (this.isDarkMode()) {
      this.document.documentElement.classList.add('dark');
    } else {
      this.document.documentElement.classList.remove('dark');
    }
  }
}
