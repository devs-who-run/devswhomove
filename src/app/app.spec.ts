import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { DEMO_ACTIVITIES, DEMO_EVENTS, DEMO_PROFILE } from './demo';
import type { Bootstrap } from './models';
import { provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';

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

  it('filters activities by sport without changing the source data', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.selectedSport.set('Tennis');
    fixture.detectChanges();
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

      const oldRequest = app.toggleAttendees(event);
      await app.toggleAttendees(event);
      expect(app.attendeeEvent()).toBeNull();
      expect(app.loadingAttendees()).toBeNull();
      const newRequest = app.toggleAttendees(event);
      const attendees = [{ name: 'Current attendee', avatar: '' }];
      const settleOld = async () => {
        if (outcome === 'success')
          resolveOld(Response.json({ attendees: [{ name: 'Stale attendee', avatar: '' }] }));
        else rejectOld(new Error('Stale request failed'));
        await oldRequest;
      };

      if (order === 'before') {
        await settleOld();
        expect(app.eventAttendees()).toEqual([]);
        expect(app.attendeeEvent()).toBe(event.id);
        expect(app.loadingAttendees()).toBe(event.id);
        expect(app.error()).toBe('');
      }
      resolveNew(Response.json({ attendees }));
      await newRequest;
      if (order === 'after') await settleOld();
      expect(app.eventAttendees()).toEqual(attendees);
      expect(app.attendeeEvent()).toBe(event.id);
      expect(app.loadingAttendees()).toBeNull();
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
    fixture.componentInstance.agentName = 'Activity importer';
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ token: 'new-agent-token' }))
      .mockResolvedValueOnce(Response.json({ tokens: [] }));
    await fixture.componentInstance.createToken();
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

  it('loads the signed-in identity on a direct /profile route', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
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
    expect(fixture.nativeElement.textContent).toContain('No activities match these filters.');
  });

  it('loads all profile activities separately from the feed and filters the calendar and list', async () => {
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
      vi.fn(async (path: string) =>
        path === '/api/bootstrap'
          ? Response.json({ ...bootstrap, viewer, activities: activities.slice(0, 100) })
          : Response.json({ profile: viewer, activities }),
      ),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();
    const app = fixture.componentInstance;
    expect(app.profileStats().sessions).toBe(102);
    expect(app.heatmapMonths().find((month) => month.month === '2024-01')?.days[14].count).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.profile-activity')).toHaveLength(102);
    app.selectAllProfileActivities();
    expect(app.selectedActivityIds()).toHaveLength(100);
    app.clearActivitySelection();

    const selects = fixture.nativeElement.querySelectorAll(
      '.profile-filters select',
    ) as NodeListOf<HTMLSelectElement>;
    selects[0].value = '2024-01';
    selects[0].dispatchEvent(new Event('change'));
    selects[1].value = 'Cycling';
    selects[1].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.profile-activity')).toHaveLength(1);
    expect(app.heatmapMonths()[0].days[14].count).toBe(1);
    app.profileSport.set('Running');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.profile-activity')).toHaveLength(0);
    expect(app.heatmapMonths()[0].days[14].count).toBe(0);
    expect(app.profileStats().sessions).toBe(102);
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
      vi.fn(async () => Response.json({ ...bootstrap, viewer, activities })),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/profile');
    await fixture.whenStable();
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
    expect(fixture.componentInstance.profileForm.visibility).toBe('public');
    expect(viewer.visibility).toBe('private');
    await fixture.componentInstance.save();
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
    vi.mocked(fetch).mockImplementation(async () => Response.json({ ...bootstrap, viewer }));
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
    fixture.componentInstance.openModal('activity');
    expect(fixture.componentInstance.modal()).toBeNull();
    expect(fixture.componentInstance.notice()).toContain('Sign in with GitHub');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('opens an in-app AT Protocol sign-in form instead of a browser prompt', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.atprotoConfigured.set(true);
    app.loginAtproto();
    fixture.detectChanges();
    expect(app.modal()).toBe('atproto-login');
    expect(fixture.nativeElement.querySelector('#atproto-handle')).toMatchObject({
      required: true,
      maxLength: 253,
      placeholder: 'you.bsky.social',
    });
    expect(fixture.nativeElement.textContent).toContain('review and approve access');
    expect(fixture.nativeElement.textContent).toContain('Continue to Bluesky');
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

  it('selects profile activities and confirms a bulk public visibility change', async () => {
    const viewer = { ...DEMO_PROFILE, id: 'me' };
    const activities = DEMO_ACTIVITIES.slice(0, 2).map((activity) => ({
      ...activity,
      userId: 'me',
    }));
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
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
    expect(fixture.componentInstance.bulkVisibilityMode()).toBe(false);
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
    app.preparePhoto = vi.fn().mockResolvedValue(photo);
    app.modal.set('activity');
    app.activityForm.title = 'Lunch run';
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [new File(['raw'], 'run.heic', { type: 'image/heic' })],
    });
    await app.choosePhoto({ target: input } as unknown as Event);
    expect(app.photoPreview()).toBe('blob:preview');
    await app.save();
    const upload = fetchMock.mock.calls.find(([path]) => path === '/api/activities/new/photo');
    expect(upload?.[1]).toMatchObject({
      method: 'PUT',
      body: photo,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(app.notice()).toBe('Activity logged. Every little move counts.');
    expect(app.photo()).toBeNull();
    fixture.detectChanges();
    const image = fixture.nativeElement.querySelector('.activity-photo') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(photoUrl);
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
    app.modal.set('activity');
    app.photo.set(new Blob(['x'], { type: 'image/jpeg' }));
    await app.save();
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
    expect(app.editingEvent()).toBe('evt-1');
    expect(app.eventForm).toMatchObject({
      title: 'Morning tennis',
      capacity: 4,
      location: 'City courts',
    });
    expect(fixture.nativeElement.querySelector('#modal-title')?.textContent).toContain(
      'Fine-tune your event.',
    );
    app.eventForm.capacity = 8;
    await app.save();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch?.[0]).toBe('/api/events/evt-1');
    expect(JSON.parse(patch?.[1]?.body as string)).toMatchObject({
      capacity: 8,
      startsAt: '2098-01-01T09:00:00.000Z',
    });
    expect(app.notice()).toContain('Event updated');
  });
});
