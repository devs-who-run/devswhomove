import { Injectable, signal, effect, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  isDarkMode = signal(false);
  private readonly document = inject(DOCUMENT);

  constructor() {
    if (window !== undefined) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.isDarkMode.set(mediaQuery.matches);

      mediaQuery.addEventListener('change', (e) => {
        this.isDarkMode.set(e.matches);
        this.updateDocumentClass();
      });
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
