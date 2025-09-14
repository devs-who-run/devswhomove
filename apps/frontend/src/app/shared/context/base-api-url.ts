import { InjectionToken, isDevMode } from '@angular/core';

export const BASE_API_URL = new InjectionToken<string>('BASE_API_URL');

export function getBaseApiUrl(): string {
  const isDevelopment =
    window.location.hostname === 'localhost' ||
    !window.location.protocol.startsWith('https');

  return isDevelopment || isDevMode()
    ? 'http://localhost:3001'
    : 'https://api.devswhorun.dev';
}
