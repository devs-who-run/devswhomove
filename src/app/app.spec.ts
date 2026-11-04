import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { DEMO_ACTIVITIES, DEMO_PROFILE } from './demo';
import type { Bootstrap } from './models';

describe('App', () => {
  const bootstrap: Bootstrap = {
    viewer: null,
    activities: [],
    events: [],
    githubConfigured: false,
  };

  beforeEach(async () => {
    window.location.hash = '';
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(bootstrap)));
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  afterEach(() => {
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePreference'];
    vi.unstubAllGlobals();
  });

  it('offers an accessible theme control and applies the selected theme', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector(
      '[aria-label="Color theme"]',
    ) as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    select.value = 'dark';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    localStorage.removeItem('dwm-theme');
  });

  it('renders a clearly labelled preview when there is no community data', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('h1')?.textContent).toContain('Your people.');
    expect(html.textContent).toContain('YOU’RE EXPLORING A PREVIEW');
    expect(html.querySelectorAll('.activity-card')).toHaveLength(4);
  });

  it('filters activities by sport without changing the source data', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.selectedSport.set('Tennis');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.activity-card')).toHaveLength(1);
    expect(fixture.componentInstance.activities()).toHaveLength(4);
  });

  it('requires sign-in rather than pretending to save guest activities', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.openModal('activity');
    expect(fixture.componentInstance.modal()).toBeNull();
    expect(fixture.componentInstance.notice()).toContain('Sign in with GitHub');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not replace a failed API with successful-looking demo data', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network unavailable'));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.componentInstance.preview()).toBe(false);
    expect(fixture.componentInstance.error()).toBe('Network unavailable');
    expect(fixture.componentInstance.activities()).toEqual([]);
  });

  it('uses live account data instead of samples after sign-in', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        ...bootstrap,
        viewer: DEMO_PROFILE,
        activities: [DEMO_ACTIVITIES[0]],
      }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.componentInstance.preview()).toBe(false);
    expect(fixture.componentInstance.myActivities()).toHaveLength(1);
  });

  it('shows actionable setup feedback when OAuth is not configured', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.login();
    expect(fixture.componentInstance.error()).toContain('OAuth client ID and secret');
  });

  it('calculates pace with a carry when seconds round up', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(
      fixture.componentInstance.pace({ ...DEMO_ACTIVITIES[0], distance: 1, duration: 5.999 }),
    ).toBe('6:00');
  });
});
