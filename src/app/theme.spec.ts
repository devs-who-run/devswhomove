import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Theme } from './theme';

describe('Theme', () => {
  let dark: boolean;
  let onChange: () => void;
  let removeListener = vi.fn<(type: string, listener: unknown) => void>();

  beforeEach(() => {
    dark = false;
    document.documentElement.dataset['themePreference'] = 'system';
    removeListener = vi.fn<(type: string, listener: unknown) => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return dark;
        },
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
          onChange = listener as () => void;
        },
        removeEventListener: removeListener,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePreference'];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('defaults to the system preference and follows live OS changes', () => {
    const theme = TestBed.inject(Theme);
    expect(theme.preference()).toBe('system');
    expect(document.documentElement.dataset['theme']).toBe('light');
    dark = true;
    onChange();
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('restores the explicit preference applied before Angular loads', () => {
    document.documentElement.dataset['themePreference'] = 'dark';
    const theme = TestBed.inject(Theme);
    expect(theme.preference()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('persists changes and keeps an explicit light preference during OS updates', () => {
    dark = true;
    const theme = TestBed.inject(Theme);
    theme.setPreference('light');
    expect(localStorage.setItem).toHaveBeenCalledWith('dwm-theme', 'light');
    onChange();
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('resumes OS updates after selecting system mode', () => {
    const theme = TestBed.inject(Theme);
    theme.setPreference('dark');
    theme.setPreference('system');
    expect(document.documentElement.dataset['theme']).toBe('light');
    dark = true;
    onChange();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.setItem).toHaveBeenLastCalledWith('dwm-theme', 'system');
  });

  it('still changes theme if browser storage is blocked and reports the failure', () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    TestBed.inject(Theme).setPreference('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('could not be saved'),
      expect.any(Error),
    );
  });

  it('removes its media listener when destroyed', () => {
    TestBed.inject(Theme);
    TestBed.resetTestingModule();
    expect(removeListener).toHaveBeenCalledWith('change', onChange);
  });
});
