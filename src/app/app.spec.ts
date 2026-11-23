import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { ActivityCalendar } from './activity-calendar';
import { AdventCalendar } from './advent-calendar';
import { By } from '@angular/platform-browser';
import { NgForm } from '@angular/forms';
import { DEMO_ACTIVITIES, DEMO_EVENTS, DEMO_PROFILE } from './demo';
import type { Bootstrap } from './models';
import { provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';
import type { GithubInsights, WeeklyRecap } from './insights.models';

describe('App', () => {
  const bootstrap: Bootstrap = {
    viewer: null,
    activities: [],
    events: [],
    githubConfigured: false,
  };
  function insightsResponse(path: string): Response | undefined {
    const period = { start: '2026-11-02', end: '2026-11-08' };
    if (path === '/api/insights/weekly') {
      const totals = { sessions: 0, minutes: 0, distanceKm: 0, activeDays: 0, bySport: [] };
      return Response.json({
        period,
        previousPeriod: { start: '2026-10-26', end: '2026-11-01' },
        current: totals,
        previous: totals,
        summary: 'No activities logged last week.',
        coverage: 'Your logged activities, including private activities.',
      } satisfies WeeklyRecap);
    }
    if (path === '/api/insights/github')
      return Response.json({
        period,
        pushEvents: 0,
        commits: 0,
        coverage: 'Public commits and pushes are incomplete.',
        complete: false,
        username: DEMO_PROFILE.username,
      } satisfies GithubInsights);
    return undefined;
  }

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
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  afterEach(() => {
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePreference'];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('offers an accessible theme control and applies the selected theme', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector(
      '[aria-label="Color theme"]',
    ) as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    const themeIcon = fixture.nativeElement.querySelector(
      '.theme-control app-icon path',
    ) as SVGPathElement;
    const systemIcon = themeIcon.getAttribute('d');
    select.value = 'dark';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(themeIcon.getAttribute('d')).not.toBe(systemIcon);
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
    expect(html.querySelector('.tabs')?.getAttribute('role')).toBe('group');
    expect(html.querySelector('.week-chart')?.getAttribute('role')).toBe('img');
    expect(html.querySelector('.week-chart')?.getAttribute('aria-label')).toContain('Monday');
  });

  it('uses the brand artwork for the home link', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('.topbar .brand') as HTMLAnchorElement;
    expect(link.getAttribute('aria-label')).toBe('Devs Who Move home');
    expect(link.querySelector('.brand-lockup-light')?.getAttribute('src')).toBe(
      '/brand/lockup_horizontal_light.svg',
    );
    expect(link.querySelector('.brand-lockup-dark')?.getAttribute('src')).toBe(
      '/brand/lockup_horizontal_dark.svg',
    );
    expect(link.querySelector('.brand-mark')?.getAttribute('src')).toBe('/brand/icon.svg');
  });

  it('shows the same short destinations in the top navbar and the mobile tab bar', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const labels = (selector: string) =>
      Array.from(
        fixture.nativeElement.querySelectorAll(selector) as NodeListOf<HTMLAnchorElement>,
        (link) => link.textContent?.trim(),
      );
    expect(labels('.primary-nav a')).toEqual(['Feed', 'Events', 'Clubs', 'Agents', 'Advent']);
    expect(labels('.tabbar a')).toEqual(['Feed', 'Events', 'Clubs', 'Agents', 'Advent']);
    expect(
      fixture.nativeElement.querySelector('.primary-nav a.active')?.getAttribute('aria-current'),
    ).toBe('page');
  });

  it('routes sign-in actions from each app entry point to the existing auth handlers', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;

    html.querySelector<HTMLButtonElement>('app-login[placement="header"] .primary')!.click();
    expect(fixture.componentInstance.error()).toContain('GitHub sign-in needs setup');
    html.querySelector<HTMLButtonElement>('app-login[placement="header"] .outline')!.click();
    expect(fixture.componentInstance.error()).toContain('AT Protocol sign-in needs setup');

    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();
    html.querySelector<HTMLButtonElement>('app-login[placement="profile"] .primary')!.click();
    expect(fixture.componentInstance.error()).toContain('GitHub sign-in needs setup');

    await TestBed.inject(Router).navigateByUrl('/agents');
    await fixture.whenStable();
    fixture.detectChanges();
    html.querySelector<HTMLButtonElement>('app-login[placement="agents"] .primary')!.click();
    expect(fixture.componentInstance.error()).toContain('GitHub sign-in needs setup');
  });

  it('connects the feed sidebar shortcuts to navigation and event creation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    html.querySelector<HTMLButtonElement>('.host-button')!.click();
    expect(fixture.componentInstance.notice()).toContain('Sign in with GitHub');

    html.querySelector<HTMLButtonElement>('.mini-event')!.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/events');

    await TestBed.inject(Router).navigateByUrl('/feed');
    await fixture.whenStable();
    html.querySelector<HTMLButtonElement>('.agent-promo button')!.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/agents');

    await TestBed.inject(Router).navigateByUrl('/feed');
    await fixture.whenStable();
    html.querySelector<HTMLButtonElement>('.clubs-promo button')!.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/clubs');
  });

  it('keeps extracted activity fields registered with the dialog form', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ ...bootstrap, viewer: { ...DEMO_PROFILE, provider: 'atproto' } }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.editor.openModal('activity');
    fixture.detectChanges();
    await fixture.whenStable();
    const form = fixture.debugElement.query(By.css('dialog form')).injector.get(NgForm);
    expect(form.controls['title']).toBeDefined();
    expect(form.controls['publicDisclosure']).toBeDefined();
    expect(form.invalid).toBe(true);

    const html = fixture.nativeElement as HTMLElement;
    const title = html.querySelector<HTMLInputElement>('#activity-title')!;
    title.value = 'An evening walk';
    title.dispatchEvent(new Event('input'));
    const disclosure = html.querySelector<HTMLInputElement>('[name="publicDisclosure"]')!;
    disclosure.click();
    fixture.detectChanges();
    expect(app.editor.activityForm.title).toBe('An evening walk');
    expect(app.editor.publicDisclosure()).toBe(true);
    expect(form.controls['title'].valid).toBe(true);
    expect(form.controls['publicDisclosure'].valid).toBe(true);
    expect(html.querySelector('#activity-photo')).toBeNull();
  });

  it('keeps extracted event fields and disclosure registered with the dialog form', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ ...bootstrap, viewer: { ...DEMO_PROFILE, provider: 'atproto' } }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.editor.openModal('event');
    fixture.detectChanges();
    await fixture.whenStable();
    const form = fixture.debugElement.query(By.css('dialog form')).injector.get(NgForm);
    expect(form.controls['title']).toBeDefined();
    expect(form.controls['publicDisclosure']).toBeDefined();
    expect(form.invalid).toBe(true);

    const html = fixture.nativeElement as HTMLElement;
    const title = html.querySelector<HTMLInputElement>('#event-title')!;
    title.value = 'Morning run';
    title.dispatchEvent(new Event('input'));
    html.querySelector<HTMLInputElement>('[name="publicDisclosure"]')!.click();
    fixture.detectChanges();
    expect(app.editor.eventForm.title).toBe('Morning run');
    expect(app.editor.publicDisclosure()).toBe(true);
    expect(form.controls['title'].valid).toBe(true);
    expect(form.controls['publicDisclosure'].valid).toBe(true);
  });

  it('filters activities by sport without changing the source data', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const tennisFilter = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-sport-filter button'),
    ).find((button) => button.textContent?.includes('Tennis')) as HTMLButtonElement;
    tennisFilter.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedSport()).toBe('Tennis');
    expect(fixture.nativeElement.querySelectorAll('.activity-card')).toHaveLength(1);
    expect(fixture.componentInstance.activities()).toHaveLength(4);
  });

  it.each([
    ['success', 'before'],
    ['error', 'before'],
    ['success', 'after'],
    ['error', 'after'],
  ] as const)(
    'ignores stale attendee request %s settling %s the latest request',
    async (outcome, order) => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const app = fixture.componentInstance;
      const event = DEMO_EVENTS[0];
      let resolveOld!: (response: Response) => void;
      let rejectOld!: (error: Error) => void;
      let resolveNew!: (response: Response) => void;
      vi.mocked(fetch)
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve, reject) => {
              resolveOld = resolve;
              rejectOld = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolveNew = resolve;
            }),
        );

      const oldRequest = app.eventActions.toggleAttendees(event);
      await app.eventActions.toggleAttendees(event);
      expect(app.eventActions.attendeeEvent()).toBeNull();
      expect(app.eventActions.loadingAttendees()).toBeNull();
      const newRequest = app.eventActions.toggleAttendees(event);
      const attendees = [{ name: 'Current attendee', avatar: '' }];
      const settleOld = async () => {
        if (outcome === 'success')
          resolveOld(Response.json({ attendees: [{ name: 'Stale attendee', avatar: '' }] }));
        else rejectOld(new Error('Stale request failed'));
        await oldRequest;
      };

      if (order === 'before') {
        await settleOld();
        expect(app.eventActions.eventAttendees()).toEqual([]);
        expect(app.eventActions.attendeeEvent()).toBe(event.id);
        expect(app.eventActions.loadingAttendees()).toBe(event.id);
        expect(app.error()).toBe('');
      }
      resolveNew(Response.json({ attendees }));
      await newRequest;
      if (order === 'after') await settleOld();
      expect(app.eventActions.eventAttendees()).toEqual(attendees);
      expect(app.eventActions.attendeeEvent()).toBe(event.id);
      expect(app.eventActions.loadingAttendees()).toBeNull();
      expect(app.error()).toBe('');
    },
  );

  it('shows a sign-in prompt at /profile, never a sample identity', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.displayedProfile()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Your profile starts with you.');
    expect(fixture.nativeElement.textContent).not.toContain('Avery Chen');
  });

  it('shows the live MCP connection details on /agents', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/agents');
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('MCP is ready to connect');
    expect(html.textContent).toContain('https://devswhorun.dev/mcp');
    expect(html.textContent).toContain('2026-07-28');
    expect(html.textContent).toContain('Configure your client to use this version');
    expect(html.textContent).toContain('Bearer YOUR_AGENT_TOKEN');
    expect(html.textContent).not.toContain('MCP next');
    expect(html.textContent).not.toContain('BETA');
    expect(html.textContent).not.toContain('DEVELOPER PREVIEW');
  });

  it('lets AT Protocol accounts grant public activity writes to agents', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        ...bootstrap,
        viewer: { ...DEMO_PROFILE, provider: 'atproto' },
      }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    vi.mocked(fetch).mockResolvedValue(Response.json({ tokens: [] }));
    await TestBed.inject(Router).navigateByUrl('/agents');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Log public activities');
    expect(fixture.nativeElement.querySelector('[name="agentWrite"]')).not.toBeNull();
    const name = fixture.nativeElement.querySelector('[name="agentName"]') as HTMLInputElement;
    name.value = 'Activity importer';
    name.dispatchEvent(new Event('input'));
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: 'new-agent-token' }))
      .mockResolvedValueOnce(Response.json({ tokens: [] }));
    fixture.nativeElement.querySelector('app-agent-page form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(fetch).toHaveBeenCalledWith(
      '/api/tokens',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Activity importer',
          scopes: ['activities:read', 'activities:write'],
        }),
      }),
    );
  });

  it('manages agent tokens and hides the one-time token when leaving the page', async () => {
    const token = {
      id: 'token-1',
      name: 'Running agent',
      scopes: ['activities:read'],
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
    };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...bootstrap, viewer: DEMO_PROFILE }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ tokens: [token] }));
    await TestBed.inject(Router).navigateByUrl('/agents');
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('.token-item')?.textContent).toContain('Running agent');

    const name = html.querySelector<HTMLInputElement>('[name="agentName"]')!;
    name.value = 'New agent';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: 'secret-once' }))
      .mockResolvedValueOnce(Response.json({ tokens: [token] }));
    html.querySelector('app-agent-page form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(html.querySelector<HTMLTextAreaElement>('#new-token')?.value).toBe('secret-once');
    expect(name.value).toBe('');

    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const revoke = html.querySelector<HTMLButtonElement>('.token-item button')!;
    revoke.click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(html.querySelector('#new-token')).not.toBeNull();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ tokens: [] }));
    revoke.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fetch).toHaveBeenCalledWith(
      '/api/tokens/token-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(html.querySelector('#new-token')).toBeNull();
    expect(html.textContent).toContain('Agent access revoked.');

    fixture.componentInstance.agent.newToken.set('another-secret');
    await TestBed.inject(Router).navigateByUrl('/feed');
    await fixture.whenStable();
    expect(fixture.componentInstance.agent.newToken()).toBe('');
  });

  it('surfaces errors when loading agent tokens', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...bootstrap, viewer: DEMO_PROFILE }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'Could not load tokens' }, { status: 500 }),
    );
    await TestBed.inject(Router).navigateByUrl('/agents');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load tokens',
    );
  });

  it('clears agent tokens when signing out from the account menu', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...bootstrap, viewer: DEMO_PROFILE }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.agent.tokens.set([
      {
        id: 'token-1',
        name: 'Running agent',
        scopes: ['activities:read'],
        createdAt: '2026-01-01T00:00:00Z',
        expiresAt: '2027-01-01T00:00:00Z',
      },
    ]);
    fixture.componentInstance.agent.newToken.set('secret-once');
    fixture.detectChanges();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(bootstrap));
    fixture.nativeElement.querySelector('.account-button').click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.account-button').getAttribute('aria-expanded'),
    ).toBe('true');
    Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.account-menu button'))
      .find((button) => button.textContent?.includes('Sign out'))!
      .click();
    await fixture.whenStable();
    expect(fixture.componentInstance.agent.tokens()).toEqual([]);
    expect(fixture.componentInstance.agent.newToken()).toBe('');
    expect(TestBed.inject(Router).url).toBe('/feed');
  });

  it('clears the viewer on logout even when reloading fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...bootstrap, viewer: DEMO_PROFILE }));
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ error: 'Offline' }, { status: 500 }));
    await app.auth.logout();
    expect(app.viewer()).toBeNull();
  });

  it('ignores agent token loads superseded by a newer load or cleared session', async () => {
    const token = (id: string) => ({
      id,
      name: id,
      scopes: ['activities:read' as const],
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
    });
    let resolveFirst!: (response: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(bootstrap));
    const fixture = TestBed.createComponent(App);
    const agent = fixture.componentInstance.agent;
    await fixture.whenStable();
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(Response.json({ tokens: [token('new')] }));
    const first = agent.load();
    await agent.load();
    resolveFirst(Response.json({ tokens: [token('stale')] }));
    await first;
    expect(agent.tokens().map((item) => item.id)).toEqual(['new']);

    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => (resolveFirst = resolve)),
    );
    const pending = agent.load();
    agent.clear();
    resolveFirst(Response.json({ tokens: [token('stale')] }));
    await pending;
    expect(agent.tokens()).toEqual([]);
  });

  it('lets AT Protocol viewers create write-only agent tokens', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ ...bootstrap, viewer: { ...DEMO_PROFILE, provider: 'atproto' } }),
      )
      .mockResolvedValue(Response.json({ tokens: [] }));
    await TestBed.inject(Router).navigateByUrl('/agents');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    const read = html.querySelector<HTMLInputElement>('input[name="agentRead"]')!;
    expect(read.checked).toBe(true);
    read.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const agent = fixture.componentInstance.agent;
    expect([agent.read, agent.write, agent.events]).toEqual([false, true, false]);
    const submit = html.querySelector<HTMLButtonElement>('app-agent-page button[type="submit"]')!;
    expect(submit.disabled).toBe(false);
  });

  it('loads the signed-in identity on a direct /profile route', async () => {
    vi.mocked(fetch).mockImplementation(
      async (path) =>
        insightsResponse(String(path)) ??
        Response.json({
          ...bootstrap,
          viewer: {
            ...DEMO_PROFILE,
            id: 'real-user',
            name: 'Signed-in developer',
            username: 'real-dev',
          },
        }),
    );
    await TestBed.inject(Router).navigateByUrl('/profile');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.page()).toBe('profile');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe('Signed-in developer');
    expect(fixture.nativeElement.textContent).not.toContain('Avery Chen');
    expect(fixture.nativeElement.textContent).toContain('No matching activities.');
    expect(fixture.nativeElement.querySelector('.heatmap-toggle')?.textContent).toContain(
      '0 sessions',
    );
  });

  it('mounts private insights and challenge only for the signed-in own profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        const insights = insightsResponse(path);
        if (insights) return insights;
        if (path === '/api/activities') return Response.json({ activities: [] });
        return Response.json({ ...bootstrap, viewer: DEMO_PROFILE });
      }),
    );
    await TestBed.inject(Router).navigateByUrl('/profile');
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('app-developer-insights')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-code-movement-challenge')).toBeTruthy();

    app.remoteProfile.set({ ...DEMO_PROFILE, id: 'someone-else', username: 'someone-else' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-developer-insights')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-code-movement-challenge')).toBeNull();

    app.remoteProfile.set(null);
    app.preview.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-developer-insights')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-code-movement-challenge')).toBeNull();

    app.preview.set(false);
    app.viewer.set(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-developer-insights')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-code-movement-challenge')).toBeNull();
  });

  it('keeps the profile focused on activity and separates progress and account tabs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        const insights = insightsResponse(path);
        if (insights) return insights;
        if (path === '/api/activities') return Response.json({ activities: [] });
        return Response.json({ ...bootstrap, viewer: DEMO_PROFILE });
      }),
    );
    await TestBed.inject(Router).navigateByUrl('/profile');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const activityTab = fixture.nativeElement.querySelector(
      '[data-profile-tab="activity"]',
    ) as HTMLButtonElement;
    const progressTab = fixture.nativeElement.querySelector(
      '[data-profile-tab="progress"]',
    ) as HTMLButtonElement;
    const activityPanel = fixture.nativeElement.querySelector(
      '#profile-activity-panel',
    ) as HTMLElement;
    const progressPanel = fixture.nativeElement.querySelector(
      '#profile-progress-panel',
    ) as HTMLElement;
    expect(activityTab.getAttribute('aria-selected')).toBe('true');
    expect(activityPanel.hidden).toBe(false);
    expect(progressPanel.hidden).toBe(true);

    activityTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(progressTab.getAttribute('aria-selected')).toBe('true');
    expect(progressPanel.hidden).toBe(false);

    expect(progressPanel.firstElementChild?.tagName).toBe('APP-ACTIVITY-CALENDAR');
    const details = Array.from(
      progressPanel.querySelectorAll<HTMLDetailsElement>(':scope > .progress-detail'),
    );
    expect(details.map((detail) => detail.querySelector('summary')?.textContent?.trim())).toEqual([
      'Badges and milestones',
      'Weekly recap and GitHub comparison',
      'Monthly digest and Wrapped',
      'Code and movement challenge',
    ]);
    expect(details.every((detail) => !detail.open)).toBe(true);
    const badgesToggle = details[0].querySelector('summary')!;
    badgesToggle.click();
    expect(details[0].open).toBe(true);
    expect(details[0].querySelector('app-profile-badges')).not.toBeNull();
    badgesToggle.click();
    expect(details[0].open).toBe(false);

    fixture.componentInstance.profileSport.set('Cycling');
    activityTab.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.profileSport()).toBe('All');

    const accountTab = fixture.nativeElement.querySelector(
      '[data-profile-tab="account"]',
    ) as HTMLButtonElement;
    accountTab.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#profile-account-panel').hidden).toBe(false);

    fixture.componentInstance.remoteProfile.set({
      ...DEMO_PROFILE,
      id: 'someone-else',
      username: 'someone-else',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-profile-tab="account"]')).toBeNull();
    expect(activityPanel.hidden).toBe(false);
    expect(progressPanel.querySelectorAll(':scope > .progress-detail')).toHaveLength(1);
  });

  it('loads all profile activities and filters the calendar by year independently of the list month', async () => {
    const viewer = { ...DEMO_PROFILE, id: 'me', username: 'me' };
    const activities = Array.from({ length: 102 }, (_, index) => ({
      ...DEMO_ACTIVITIES[0],
      id: `activity-${index}`,
      userId: 'me',
      sport: index === 101 ? 'Cycling' : 'Running',
      occurredAt: index === 101 ? '2024-01-15T12:00:00.000Z' : '2025-02-15T12:00:00.000Z',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (path: string) =>
          insightsResponse(path) ??
          (path === '/api/bootstrap'
            ? Response.json({ ...bootstrap, viewer, activities: activities.slice(0, 100) })
            : Response.json({ profile: viewer, activities })),
      ),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const calendar = fixture.debugElement.query(By.directive(ActivityCalendar))
      .componentInstance as ActivityCalendar;
    expect(app.profileSummary.stats().sessions).toBe(102);
    expect(calendar.years()).toEqual(expect.arrayContaining([2025, 2024]));
    expect(fixture.nativeElement.querySelectorAll('.profile-activity')).toHaveLength(102);
    app.activityActions.selectAllProfileActivities();
    expect(app.activityActions.selectedActivityIds()).toHaveLength(100);
    app.activityActions.clearActivitySelection();

    const graphSelects = fixture.nativeElement.querySelectorAll(
      '.heatmap-filters select',
    ) as NodeListOf<HTMLSelectElement>;
    const monthSelect = fixture.nativeElement.querySelector(
      '.profile-filters:not(.heatmap-filters) select',
    ) as HTMLSelectElement;
    expect(monthSelect.options[1].textContent).toBe('Feb 25');
    graphSelects[0].value = '2024';
    graphSelects[0].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(app.heatmapYear()).toBe('2024');
    expect(calendar.heatmap().days.find((day) => day.date === '2024-01-15')?.count).toBe(1);
    expect(calendar.heatmap().sessions).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.profile-activity')).toHaveLength(102);
    const activityMetric = fixture.nativeElement.querySelector(
      '.profile-activity-metric',
    ) as HTMLElement;
    expect(activityMetric.querySelector('strong')?.textContent).toContain('5.2 km');
    expect(activityMetric.querySelector('span')?.textContent).toContain('34 min');
    const graph = fixture.nativeElement.querySelector('.heatmap-toggle') as HTMLDetailsElement;
    expect(graph.classList.contains('consistency-card')).toBe(true);
    expect(graph.querySelector('summary h2')?.textContent).toBe(
      'A different kind of contribution.',
    );
    expect(graph.querySelector('summary')?.textContent).toContain('Expand / collapse graph');
    expect(graph.open).toBe(true);
    (graph.querySelector('summary') as HTMLElement).click();
    expect(graph.open).toBe(false);
    (graph.querySelector('summary') as HTMLElement).click();
    expect(graph.open).toBe(true);
    monthSelect.value = '2025-02';
    monthSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(calendar.heatmap().sessions).toBe(1);
    monthSelect.value = '2024-01';
    monthSelect.dispatchEvent(new Event('change'));
    graphSelects[1].value = 'Cycling';
    graphSelects[1].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(app.profileSport()).toBe('Cycling');
    expect(fixture.nativeElement.querySelectorAll('.profile-activity')).toHaveLength(1);
    expect(calendar.heatmap().days.find((day) => day.date === '2024-01-15')?.count).toBe(1);
    app.profileSport.set('Running');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.profile-activity')).toHaveLength(0);
    expect(calendar.heatmap().sessions).toBe(0);
    expect(calendar.heatmap().days).toHaveLength(366);
    expect(app.profileSummary.stats().sessions).toBe(102);
    await TestBed.inject(Router).navigateByUrl('/feed');
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(app.heatmapYear()).toBe('last-12-months');
    expect(app.profileSport()).toBe('All');
    expect(
      (fixture.nativeElement.querySelector('.heatmap-filters select') as HTMLSelectElement).value,
    ).toBe('last-12-months');
  });

  it('shows a daily summary in the graph and accessible details, respecting activity filters', async () => {
    const viewer = { ...DEMO_PROFILE, id: 'me', username: 'me' };
    const activities = [
      {
        ...DEMO_ACTIVITIES[0],
        id: 'run',
        userId: 'me',
        sport: 'Running',
        duration: 30,
        distance: 5,
        occurredAt: '2025-02-15T12:00:00.000Z',
      },
      {
        ...DEMO_ACTIVITIES[0],
        id: 'swim',
        userId: 'me',
        sport: 'Swimming',
        duration: 20,
        distance: null,
        occurredAt: '2025-02-15T12:00:00.000Z',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (path: string) =>
          insightsResponse(path) ?? Response.json({ ...bootstrap, viewer, activities }),
      ),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.componentInstance.heatmapYear.set('2025');
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelector('.heatmap .more')?.getAttribute('title');
    expect(summary).toContain('2 sessions · Running, Swimming · 50 min · 5 km recorded');
    expect(fixture.nativeElement.querySelector('.heatmap-details').textContent).toContain(summary);

    fixture.componentInstance.profileSport.set('Swimming');
    fixture.detectChanges();
    const filtered = fixture.nativeElement.querySelector('.heatmap .moved')?.getAttribute('title');
    expect(filtered).toContain('1 session · Swimming · 20 min');
    expect(filtered).not.toContain('km');
  });

  it('uses clean router links and navigates between pages', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/events');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.page()).toBe('events');
    expect(fixture.nativeElement.querySelector('nav a').getAttribute('href')).toBe('/feed');
    await router.navigateByUrl('/feed');
    expect(fixture.componentInstance.page()).toBe('feed');
  });

  it('does not substitute a sample person for a missing public profile', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ error: 'Profile is private or does not exist.' }, { status: 404 }),
    );
    await TestBed.inject(Router).navigateByUrl('/profile/averybuilds');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.remoteProfile()).toBeNull();
    expect(fixture.componentInstance.profileError()).toContain('private or does not exist');
    expect(fixture.nativeElement.textContent).not.toContain('Avery Chen');
  });

  it('lets a private GitHub profile become public only after saving', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    const viewer = { ...DEMO_PROFILE, visibility: 'private', provider: 'github' };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const insights = insightsResponse(path);
      if (insights) return insights;
      if (path === '/api/me' && init?.method === 'PATCH') {
        viewer.visibility = 'public';
        return Response.json({ ok: true });
      }
      return Response.json({ ...bootstrap, viewer });
    });
    vi.stubGlobal('fetch', fetchMock);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();

    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
    expect(buttons.some((button) => button.textContent?.includes('Copy profile link'))).toBe(false);
    buttons.find((button) => button.textContent?.includes('Make profile public'))!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.editor.profileForm.visibility).toBe('public');
    expect(viewer.visibility).toBe('private');
    await fixture.componentInstance.editor.save();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"visibility":"public"'),
      }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Copy profile link');
  });

  it('copies a public profile link and reports clipboard failures with a manual link', async () => {
    const viewer = { ...DEMO_PROFILE, username: 'alice', visibility: 'public' as const };
    vi.mocked(fetch).mockImplementation(
      async (path) => insightsResponse(String(path)) ?? Response.json({ ...bootstrap, viewer }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (item) => item.textContent?.includes('Copy profile link'),
    )!;
    button.click();
    await fixture.whenStable();
    const url = `${window.location.origin}/profile/alice`;
    expect(writeText).toHaveBeenCalledWith(url);
    expect(fixture.componentInstance.notice()).toBe('Profile link copied.');
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    await fixture.componentInstance.copyProfileLink(viewer);
    expect(fixture.componentInstance.error()).toContain(url);
  });

  it('opens and shares encoded AT Protocol DID links without signing in', async () => {
    const profile = {
      ...DEMO_PROFILE,
      id: 'did:plc:example',
      username: 'alice.example',
      visibility: 'public' as const,
      provider: 'atproto' as const,
    };
    const fetchMock = vi.fn(async (path: string) =>
      path === '/api/bootstrap'
        ? Response.json(bootstrap)
        : Response.json({ profile, activities: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile/did%3Aplc%3Aexample');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fetchMock).toHaveBeenCalledWith('/api/profiles/did%3Aplc%3Aexample', expect.any(Object));
    expect(fixture.componentInstance.remoteProfile()).toEqual(profile);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await fixture.componentInstance.copyProfileLink(profile);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/profile/did%3Aplc%3Aexample`);
  });

  it('requires sign-in rather than pretending to save guest activities', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.editor.openModal('activity');
    expect(fixture.componentInstance.editor.modal()).toBeNull();
    expect(fixture.componentInstance.notice()).toContain('Sign in with GitHub');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('opens an in-app AT Protocol sign-in form instead of a browser prompt', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.auth.atprotoConfigured.set(true);
    app.auth.loginAtproto();
    fixture.detectChanges();
    expect(app.editor.modal()).toBe('atproto-login');
    expect(fixture.nativeElement.querySelector('#atproto-handle')).toMatchObject({
      required: true,
      maxLength: 253,
      placeholder: 'you.bsky.social',
    });
    expect(fixture.nativeElement.textContent).toContain('review and approve access');
    expect(fixture.nativeElement.textContent).toContain('Continue to Bluesky');
  });

  it('connects dialog inputs, actions, and cancellation to the app', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...bootstrap, viewer: DEMO_PROFILE }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.editor.openModal('profile');
    fixture.detectChanges();
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;
    const name = html.querySelector<HTMLInputElement>('#profile-name')!;
    name.value = 'Updated name';
    name.dispatchEvent(new Event('input'));
    const sport = [
      ...html.querySelectorAll<HTMLButtonElement>('[aria-label="Choose your sports"] button'),
    ].find((button) => button.textContent?.trim() === 'Tennis')!;
    const hadTennis = app.editor.profileForm.sports.includes('Tennis');
    sport.click();
    fixture.detectChanges();
    expect(app.editor.profileForm.name).toBe('Updated name');
    expect(app.editor.profileForm.sports.includes('Tennis')).toBe(!hadTennis);

    html.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click();
    expect(app.editor.modal()).toBeNull();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();

    app.auth.atprotoConfigured.set(true);
    app.auth.loginAtproto();
    fixture.detectChanges();
    await fixture.whenStable();
    const handle = html.querySelector<HTMLInputElement>('#atproto-handle')!;
    handle.value = '  ';
    handle.dispatchEvent(new Event('input'));
    html.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit'));
    expect(app.editor.atprotoHandle).toBe('  ');
    expect(app.error()).toContain('Enter a valid AT Protocol handle');
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
    expect(fixture.componentInstance.feed.myActivities()).toHaveLength(1);
  });

  it('selects profile activities and confirms a bulk public visibility change', async () => {
    const viewer = { ...DEMO_PROFILE, id: 'me' };
    const activities = DEMO_ACTIVITIES.slice(0, 2).map((activity) => ({
      ...activity,
      userId: 'me',
    }));
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const insights = insightsResponse(path);
      if (insights) return insights;
      if (path === '/api/activities/bulk-visibility')
        return Response.json({ ok: true, updated: 1 });
      return Response.json({ ...bootstrap, viewer, activities });
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();

    const button = (label: string) =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((item) =>
        item.textContent?.includes(label),
      ) as HTMLButtonElement;
    button('Select activities').click();
    fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelector(
      '.profile-activity-select input',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button('Make public').click();
    await fixture.whenStable();

    expect(confirm).toHaveBeenCalledOnce();
    const update = fetchMock.mock.calls.find(
      ([path]) => path === '/api/activities/bulk-visibility',
    );
    expect(update?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ ids: [activities[0].id], visibility: 'public' }),
    });
    expect(fixture.componentInstance.activityActions.bulkVisibilityMode()).toBe(false);
    expect(fixture.componentInstance.notice()).toBe('1 activity is now public.');
  });

  it('explains that public activities stay hidden while the profile is private', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        ...bootstrap,
        viewer: { ...DEMO_PROFILE, visibility: 'private', provider: 'github' },
        activities: [{ ...DEMO_ACTIVITIES[0], userId: DEMO_PROFILE.id, visibility: 'public' }],
      }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(fixture.componentInstance.profileHidden()).toBe(true);
    expect(text).toContain('Your profile is private.');
    expect(text).toContain('Public · hidden while your profile is private');
  });

  it('does not warn about privacy once the profile is public', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        ...bootstrap,
        viewer: { ...DEMO_PROFILE, visibility: 'public', provider: 'github' },
        activities: [{ ...DEMO_ACTIVITIES[0], userId: DEMO_PROFILE.id, visibility: 'public' }],
      }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(fixture.componentInstance.profileHidden()).toBe(false);
    expect(text).not.toContain('Your profile is private.');
    expect(text).toContain('Public activity');
  });

  it('shows actionable setup feedback when OAuth is not configured', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.auth.login();
    expect(fixture.componentInstance.error()).toContain('OAuth client ID and secret');
  });

  it('calculates pace with a carry when seconds round up', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(
      fixture.componentInstance.pace({ ...DEMO_ACTIVITIES[0], distance: 1, duration: 5.999 }),
    ).toBe('6:00');
  });

  it('uploads a prepared photo after logging an activity and shows it in the feed', async () => {
    HTMLDialogElement.prototype.close = vi.fn();
    const viewer = { ...DEMO_PROFILE, id: 'me', username: 'me' };
    const photoUrl = '/api/activities/new/photo?v=abc';
    let uploaded = false;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/activities' && init?.method === 'POST')
        return Response.json({ id: 'new' }, { status: 201 });
      if (path === '/api/activities/new/photo' && init?.method === 'PUT') {
        uploaded = true;
        return Response.json({ photo: photoUrl });
      }
      return Response.json({
        ...bootstrap,
        viewer,
        activities: uploaded ? [{ ...DEMO_ACTIVITIES[0], userId: 'me', photo: photoUrl }] : [],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() }),
    );
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
    app.editor.preparePhoto = vi.fn().mockResolvedValue(photo);
    app.editor.modal.set('activity');
    app.editor.activityForm.title = 'Lunch run';
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [new File(['raw'], 'run.heic', { type: 'image/heic' })],
    });
    await app.editor.choosePhoto({ target: input } as unknown as Event);
    expect(app.editor.photoPreview()).toBe('blob:preview');
    await app.editor.save();
    const upload = fetchMock.mock.calls.find(([path]) => path === '/api/activities/new/photo');
    expect(upload?.[1]).toMatchObject({
      method: 'PUT',
      body: photo,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(app.notice()).toBe('Activity logged. Every little move counts.');
    expect(app.editor.photo()).toBeNull();
    fixture.detectChanges();
    const image = fixture.nativeElement.querySelector('.activity-photo') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(photoUrl);
  });

  it('lets an Advent recovery day be logged with an optional photo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 7, 8, 15));
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    const viewer = { ...DEMO_PROFILE, id: 'advent-photo-user', provider: 'github' as const };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/activities' && init?.method === 'POST')
        return Response.json({ id: 'advent-activity' }, { status: 201 });
      if (path === '/api/activities/advent-activity/photo' && init?.method === 'PUT')
        return Response.json({ photo: '/api/activities/advent-activity/photo?v=1' });
      if (path.startsWith('/api/profiles/'))
        return Response.json({ profile: viewer, activities: [] });
      return Response.json({ ...bootstrap, viewer });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:advent-photo', revokeObjectURL: vi.fn() }),
    );

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/advent');
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    const calendar = fixture.debugElement.query(By.directive(AdventCalendar))
      .componentInstance as AdventCalendar;
    calendar.now.set(new Date(2026, 11, 7, 8, 15));
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('.advent-challenge')?.textContent).toContain('Count as recovery');
    expect(html.querySelector('.advent-challenge')?.textContent).toContain('optional photo');
    html.querySelector<HTMLButtonElement>('.advent-challenge .button.primary')!.click();
    fixture.detectChanges();
    expect(app.editor.activityForm.occurredAt).toBe('2026-12-07T08:15');

    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
    app.editor.preparePhoto = vi.fn().mockResolvedValue(photo);
    const input = html.querySelector<HTMLInputElement>('#activity-photo')!;
    expect(input.accept).toBe('image/*');
    Object.defineProperty(input, 'files', {
      value: [new File(['raw'], 'walk.jpg', { type: 'image/jpeg' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(app.editor.photo()).toBe(photo));
    fixture.detectChanges();
    expect(html.querySelector('.photo-preview img')?.getAttribute('src')).toBe('blob:advent-photo');
    app.editor.activityForm.title = 'Recovery walk';
    await app.editor.save();

    const activityRequest = fetchMock.mock.calls.find(([path]) => path === '/api/activities');
    expect(JSON.parse(activityRequest![1]!.body as string).occurredAt).toBe(
      new Date(2026, 11, 7, 8, 15).toISOString(),
    );
    const upload = fetchMock.mock.calls.find(
      ([path]) => path === '/api/activities/advent-activity/photo',
    );
    expect(upload?.[1]).toMatchObject({ method: 'PUT', body: photo });
    expect(app.notice()).toBe('Activity logged. Every little move counts.');
    app.logAdventActivity('2026-12-06');
    expect(app.editor.activityForm.occurredAt).toBe('2026-12-06T12:00');
  });

  it('does not show private Advent progress after the viewer signs out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 7, 12));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.page.set('advent');
    app.viewer.set({ ...DEMO_PROFILE, id: 'private-advent-user', visibility: 'private' });
    app.ownProfileActivities.set([
      { ...DEMO_ACTIVITIES[0], occurredAt: new Date(2026, 11, 1, 12).toISOString() },
    ]);
    fixture.detectChanges();
    const calendar = fixture.debugElement.query(By.directive(AdventCalendar))
      .componentInstance as AdventCalendar;
    expect(calendar.completedDays()).toBe(1);
    calendar.toggleRestDay(calendar.days()[6]);
    expect(calendar.completedDays()).toBe(2);

    app.viewer.set(null);
    fixture.detectChanges();
    expect(calendar.completedDays()).toBe(0);
    localStorage.removeItem('devs-who-move:advent:2026:private-advent-user');
  });

  it('ignores photo preparation that finishes after the dialog closes', async () => {
    HTMLDialogElement.prototype.close = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...bootstrap, viewer: DEMO_PROFILE }));
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    let resolvePhoto!: (photo: Blob) => void;
    app.editor.preparePhoto = vi.fn(() => new Promise<Blob>((resolve) => (resolvePhoto = resolve)));
    app.editor.modal.set('activity');
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [new File(['raw'], 'run.jpg', { type: 'image/jpeg' })],
    });
    const choosing = app.editor.choosePhoto({ target: input } as unknown as Event);
    expect(app.editor.photoBusy()).toBe(true);
    app.editor.closeModal();
    expect(app.editor.photoBusy()).toBe(false);
    resolvePhoto(new Blob(['jpeg'], { type: 'image/jpeg' }));
    await choosing;
    expect(app.editor.photo()).toBeNull();
    expect(app.editor.photoPreview()).toBe('');
  });

  it('keeps the activity and explains when only the photo upload fails', async () => {
    HTMLDialogElement.prototype.close = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/activities') return Response.json({ id: 'new' }, { status: 201 });
        if (init?.method === 'PUT')
          return Response.json(
            { error: 'Upload a valid JPEG, PNG or WebP image.' },
            { status: 400 },
          );
        return Response.json({ ...bootstrap, viewer: DEMO_PROFILE });
      }),
    );
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    app.editor.modal.set('activity');
    app.editor.photo.set(new Blob(['x'], { type: 'image/jpeg' }));
    await app.editor.save();
    expect(app.notice()).toContain('photo didn’t upload: Upload a valid JPEG');
    expect(app.error()).toBe('');
  });

  it('lets the host edit an event with the form prefilled', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    const event = {
      id: 'evt-1',
      hostId: DEMO_PROFILE.id,
      hostName: DEMO_PROFILE.name,
      title: 'Morning tennis',
      sport: 'Tennis' as const,
      startsAt: '2098-01-01T09:00:00.000Z',
      location: 'City courts',
      description: 'Bring a racket.',
      level: 'All levels welcome',
      capacity: 4,
      attendees: 2,
      joined: true,
      conferenceName: 'NG-Conf',
      conferenceUrl: 'https://ng-conf.example',
    };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? Response.json({ ok: true })
        : Response.json({ ...bootstrap, viewer: DEMO_PROFILE, events: [event] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/events');
    await fixture.whenStable();
    fixture.detectChanges();
    const edit = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Edit event',
    ) as HTMLButtonElement;
    edit.click();
    fixture.detectChanges();
    expect(app.editor.editingEvent()).toBe('evt-1');
    expect(app.editor.eventForm).toMatchObject({
      title: 'Morning tennis',
      capacity: 4,
      location: 'City courts',
      conferenceName: 'NG-Conf',
      conferenceUrl: 'https://ng-conf.example',
    });
    expect(fixture.nativeElement.querySelector('#modal-title')?.textContent).toContain(
      'Fine-tune your event.',
    );
    app.editor.eventForm.capacity = 8;
    await app.editor.save();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch?.[0]).toBe('/api/events/evt-1');
    expect(JSON.parse(patch?.[1]?.body as string)).toMatchObject({
      capacity: 8,
      startsAt: '2098-01-01T09:00:00.000Z',
      conferenceName: 'NG-Conf',
      conferenceUrl: 'https://ng-conf.example',
    });
    expect(app.notice()).toContain('Event updated');
  });

  it('connects the events page filters and actions to the app', async () => {
    const hosted = { ...DEMO_EVENTS[0], hostId: DEMO_PROFILE.id };
    const joining = DEMO_EVENTS[1];
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ ...bootstrap, viewer: DEMO_PROFILE, events: [hosted, joining] }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/events');
    await fixture.whenStable();
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const attendees = vi.spyOn(app.eventActions, 'toggleAttendees').mockResolvedValue();
    const cancel = vi.spyOn(app.eventActions, 'cancel').mockResolvedValue();
    const join = vi.spyOn(app.eventActions, 'join').mockResolvedValue();
    const host = vi.spyOn(app.editor, 'openModal').mockImplementation(() => {});
    const html = fixture.nativeElement as HTMLElement;
    const buttons = [...html.querySelectorAll<HTMLButtonElement>('app-events-page button')];

    buttons.find((button) => button.textContent?.trim() === 'Host an event')!.click();
    buttons.find((button) => button.textContent?.trim() === 'View attendees')!.click();
    buttons.find((button) => button.textContent?.trim() === 'Cancel event')!.click();
    buttons.find((button) => button.textContent?.trim() === 'Count me in')!.click();
    expect(host).toHaveBeenCalledWith('event');
    expect(attendees).toHaveBeenCalledWith(hosted);
    expect(cancel).toHaveBeenCalledWith(hosted);
    expect(join).toHaveBeenCalledWith(joining);

    buttons.find((button) => button.textContent?.trim() === 'Tennis')!.click();
    fixture.detectChanges();
    expect(app.selectedSport()).toBe('Tennis');
    expect(html.querySelectorAll('app-events-page .event-card')).toHaveLength(1);
    expect(html.querySelector('app-events-page .event-card')?.textContent).toContain(joining.title);
  });

  it.each(['github', 'atproto'] as const)(
    'creates optional conference events for %s with public disclosure preserved',
    async (provider) => {
      HTMLDialogElement.prototype.showModal = vi.fn();
      HTMLDialogElement.prototype.close = vi.fn();
      const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? Response.json({ id: 'new' }, { status: 201 })
          : Response.json({ ...bootstrap, viewer: { ...DEMO_PROFILE, provider } }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      await fixture.whenStable();
      app.editor.openModal('event');
      expect(app.editor.eventForm).toMatchObject({ conferenceName: '', conferenceUrl: '' });
      Object.assign(app.editor.eventForm, {
        title: 'Morning 5K',
        location: 'Park',
        conferenceName: ' NG-Conf ',
        conferenceUrl: ' https://ng-conf.example ',
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#conference-name')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('#conference-url')).toBeTruthy();
      if (provider === 'atproto') {
        await app.editor.save();
        expect(app.error()).toContain('publicly visible');
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
        app.editor.publicDisclosure.set(true);
      }
      await app.editor.save();
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(post?.[1]?.body as string)).toMatchObject({
        conferenceName: 'NG-Conf',
        conferenceUrl: 'https://ng-conf.example',
      });
    },
  );

  it.each([
    'http://ng-conf.example',
    'javascript:alert(1)',
    '//ng-conf.example',
    'https://user:password@ng-conf.example',
    'https://@ng-conf.example',
    'https:///ng-conf.example',
    'https://ng-conf.exa\nmple',
    'https://ng-conf.example\\@evil.example',
  ])(
    'rejects unsafe conference URL %s before saving or rendering a link',
    async (conferenceUrl) => {
      const event = { ...DEMO_EVENTS[0], conferenceName: 'NG-Conf', conferenceUrl };
      const fetchMock = vi.fn(async () =>
        Response.json({ ...bootstrap, viewer: DEMO_PROFILE, events: [event] }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      await fixture.whenStable();
      await TestBed.inject(Router).navigateByUrl('/events');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.event-conference')?.textContent).toContain(
        'NG-Conf',
      );
      expect(fixture.nativeElement.querySelector('.event-conference a')).toBeNull();
      app.editor.modal.set('event');
      Object.assign(app.editor.eventForm, { conferenceName: 'NG-Conf', conferenceUrl });
      const callsBefore = fetchMock.mock.calls.length;
      await app.editor.save();
      expect(app.error()).toContain('safe HTTPS URL');
      expect(fetchMock.mock.calls).toHaveLength(callsBefore);
    },
  );

  it('renders conference links and name-only associations without changing legacy events', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    const events = [
      { ...DEMO_EVENTS[0], conferenceName: 'NG-Conf', conferenceUrl: 'https://ng-conf.example' },
      { ...DEMO_EVENTS[1], conferenceName: 'BikeConf' },
      DEMO_EVENTS[2],
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...bootstrap, viewer: DEMO_PROFILE, events })),
    );
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/events');
    await fixture.whenStable();
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.event-card');
    const link = cards[0].querySelector('.event-conference a');
    expect(link.getAttribute('href')).toBe('https://ng-conf.example');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(cards[1].querySelector('.event-conference')?.textContent).toContain('BikeConf');
    expect(cards[1].querySelector('.event-conference a')).toBeNull();
    expect(cards[2].querySelector('.event-conference')).toBeNull();
    app.editor.editEvent(DEMO_EVENTS[2]);
    expect(app.editor.eventForm).toMatchObject({ conferenceName: '', conferenceUrl: '' });
    app.editor.eventForm.conferenceUrl = 'https://ng-conf.example';
    await app.editor.save();
    expect(app.error()).toContain('Add a conference name');
  });

  describe('social features', () => {
    const viewer = { ...DEMO_PROFILE, id: 'me', username: 'me' };
    const friendActivity = {
      ...DEMO_ACTIVITIES[0],
      id: 'friend-run',
      userId: 'friend',
      username: 'friend',
      name: 'Friend',
      visibility: 'public' as const,
      kudos: 2,
      kudoed: false,
      comments: 0,
    };
    const club = {
      id: 'club-1',
      slug: 'angular-devs-who-run',
      name: 'Angular devs who run',
      description: 'Easy runs.',
      sport: 'Running' as const,
      owned: false,
      ownerName: 'Friend',
      members: 3,
      joined: false,
    };
    const button = (root: HTMLElement, text: string) =>
      [...root.querySelectorAll('button')].find((item) =>
        item.textContent?.replace(/\s+/g, ' ').trim().startsWith(text),
      ) as HTMLButtonElement;

    function mockApi(
      user: typeof viewer | null,
      routes: Record<string, (init?: RequestInit) => unknown> = {},
    ) {
      const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
        const handler = routes[`${init?.method ?? 'GET'} ${path}`];
        if (handler) return Response.json(handler(init));
        return Response.json({
          ...bootstrap,
          viewer: user,
          activities: [friendActivity],
          clubs: [club],
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('gives kudos from the feed and updates the count', async () => {
      const fetchMock = mockApi(viewer, {
        'POST /api/activities/friend-run/kudos': () => ({ kudos: 3, kudoed: true }),
      });
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      button(root, '2 kudos').click();
      await fixture.whenStable();
      fixture.detectChanges();
      const kudos = fetchMock.mock.calls.find(([path]) => path.endsWith('/kudos'));
      expect(JSON.parse(kudos?.[1]?.body as string)).toEqual({ kudos: true });
      expect(button(root, '3 kudos').getAttribute('aria-pressed')).toBe('true');
    });

    it('asks private profiles to go public before giving kudos', async () => {
      const fetchMock = mockApi({ ...viewer, visibility: 'private' });
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      button(root, '2 kudos').click();
      fixture.detectChanges();
      expect(root.textContent).toContain('Make your profile public to give kudos and comment.');
      expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/kudos'))).toBe(false);
    });

    it('shows only followed people on the Following tab', async () => {
      mockApi(viewer, {
        'GET /api/feed?scope=following': () => ({ activities: [] }),
      });
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      button(root, 'Following').click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.feed.filteredActivities()).toEqual([]);
      expect(root.textContent).toContain('Follow people from their profile');
    });

    it('follows a remote profile and shows follower counts', async () => {
      const fetchMock = mockApi(viewer, {
        'GET /api/profiles/friend': () => ({
          profile: { ...viewer, id: 'friend', username: 'friend', name: 'Friend' },
          activities: [],
          social: { followers: 4, following: 1, viewerFollows: false },
        }),
        'POST /api/follows': () => ({ followers: 5, following: 1, viewerFollows: true }),
      });
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      await TestBed.inject(Router).navigateByUrl('/profile/friend');
      await fixture.whenStable();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent?.replace(/\s+/g, ' ')).toContain('4 followers · 1 following');
      button(root, 'Follow').click();
      await fixture.whenStable();
      fixture.detectChanges();
      const follow = fetchMock.mock.calls.find(([path]) => path === '/api/follows');
      expect(JSON.parse(follow?.[1]?.body as string)).toEqual({ userId: 'friend', follow: true });
      expect(button(root, 'Following').getAttribute('aria-pressed')).toBe('true');
    });

    it('lists clubs, joins one, and creates a new club', async () => {
      HTMLDialogElement.prototype.showModal = vi.fn();
      HTMLDialogElement.prototype.close = vi.fn();
      const created = { ...club, id: 'club-2', slug: 'ng-riders', name: 'NG riders' };
      const fetchMock = mockApi(viewer, {
        [`POST /api/clubs/${club.slug}/membership`]: () => ({ club: { ...club, joined: true } }),
        'POST /api/clubs': () => ({ club: created }),
        'GET /api/clubs/ng-riders': () => ({
          club: created,
          members: [],
          activities: [],
          events: [],
        }),
      });
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      await fixture.whenStable();
      await TestBed.inject(Router).navigateByUrl('/clubs');
      await fixture.whenStable();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('Angular devs who run');
      button(root, 'Join club').click();
      await fixture.whenStable();
      const join = fetchMock.mock.calls.find(([path]) => path.endsWith('/membership'));
      expect(JSON.parse(join?.[1]?.body as string)).toEqual({ join: true });
      app.editor.openModal('club');
      app.editor.clubForm = { name: 'NG riders', description: '', sport: '' };
      await app.editor.save();
      await fixture.whenStable();
      const create = fetchMock.mock.calls.find(
        ([path, init]) => path === '/api/clubs' && init?.method === 'POST',
      );
      expect(JSON.parse(create?.[1]?.body as string)).toEqual({
        name: 'NG riders',
        description: '',
        sport: null,
      });
      expect(TestBed.inject(Router).url).toBe('/clubs/ng-riders');
      expect(app.clubActions.detail()?.club.name).toBe('NG riders');
    });

    it('shares a club invite link from the club page', async () => {
      mockApi(viewer, {
        [`GET /api/clubs/${club.slug}`]: () => ({ club, members: [], activities: [], events: [] }),
      });
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      await fixture.whenStable();
      await TestBed.inject(Router).navigateByUrl(`/clubs/${club.slug}`);
      await fixture.whenStable();
      fixture.detectChanges();
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      button(fixture.nativeElement as HTMLElement, 'Invite people').click();
      await fixture.whenStable();
      const url = `${window.location.origin}/clubs/${club.slug}`;
      expect(writeText).toHaveBeenCalledWith(url);
      expect(app.notice()).toContain('invite link copied');

      const share = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { share, clipboard: { writeText } });
      await app.clubActions.share(club);
      expect(share).toHaveBeenCalledWith(expect.objectContaining({ url }));
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it('connects club detail event actions to the app', async () => {
      const joinedClub = { ...club, joined: true };
      const event = DEMO_EVENTS[0];
      mockApi(viewer, {
        [`GET /api/clubs/${club.slug}`]: () => ({
          club: joinedClub,
          members: [],
          activities: [],
          events: [event],
        }),
      });
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      await TestBed.inject(Router).navigateByUrl(`/clubs/${club.slug}`);
      await fixture.whenStable();
      fixture.detectChanges();
      const app = fixture.componentInstance;
      const host = vi.spyOn(app.editor, 'openModal').mockImplementation(() => {});
      const join = vi.spyOn(app.eventActions, 'join').mockResolvedValue();
      const leave = vi.spyOn(app.clubActions, 'toggleMembership').mockResolvedValue();
      const root = fixture.nativeElement as HTMLElement;
      button(root, 'Host a club event').click();
      button(root, 'Count me in').click();
      button(root, 'Leave club').click();
      expect(host).toHaveBeenCalledWith('event');
      expect(join).toHaveBeenCalledWith(event);
      expect(leave).toHaveBeenCalledWith(joinedClub);
    });
  });
});
