import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeveloperInsights } from './developer-insights';
import type { GithubInsights, WeeklyRecap } from './insights.models';
import type { Profile } from './models';

const profile: Profile = {
  id: 'github-1',
  username: 'runner',
  name: 'Runner',
  avatar: '',
  bio: '',
  location: '',
  sports: ['Running'],
  visibility: 'private',
  provider: 'github',
};
const recap: WeeklyRecap = {
  period: { start: '2026-11-02', end: '2026-11-08' },
  previousPeriod: { start: '2026-10-26', end: '2026-11-01' },
  current: {
    sessions: 2,
    minutes: 60,
    distanceKm: 10,
    activeDays: 2,
    bySport: [{ sport: 'Running', sessions: 2, minutes: 60, distanceKm: 10 }],
  },
  previous: { sessions: 1, minutes: 30, distanceKm: 5, activeDays: 1, bySport: [] },
  summary: 'You logged 2 sessions and 10 km.',
  coverage: 'Based on your logged activities only.',
};
const github: GithubInsights = {
  period: recap.period,
  pushEvents: 3,
  commits: 7,
  complete: false,
  coverage: 'Public events may be truncated.',
  username: profile.username,
};

describe('DeveloperInsights', () => {
  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        Promise.resolve(Response.json(path.endsWith('/weekly') ? recap : github)),
      ),
    );
    await TestBed.configureTestingModule({ imports: [DeveloperInsights] }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function create(account: Profile = profile) {
    const fixture = TestBed.createComponent(DeveloperInsights);
    fixture.componentRef.setInput('profile', account);
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<DeveloperInsights>) {
    await vi.waitFor(() => {
      expect(fixture.componentInstance.weekly().loading).toBe(false);
      if (fixture.componentInstance.isGithub()) {
        expect(fixture.componentInstance.github().loading).toBe(false);
      }
    });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads authenticated resources and labels UTC dates, coverage and numerical changes', async () => {
    const fixture = create();
    await settle(fixture);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(fetch).toHaveBeenCalledWith(
      '/api/insights/weekly',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store' }),
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/insights/github',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(text).toContain('2026-11-02');
    expect(text).toContain('2026-11-08 (UTC)');
    expect(text).toContain('2026-10-26');
    expect(text).toContain('+1 session');
    expect(text).toContain('+30 minutes');
    expect(text).toContain('+5 km');
    expect(text).toContain('+1 active day');
    expect(text).toContain(recap.summary);
    expect(text).toContain(github.coverage);
    expect(text).toContain('Incomplete coverage');
    expect(text).toContain('activities:read');
    expect(text).toContain('get_weekly_recap');
    expect(text).toContain('No hosted LLM runs here');
    expect(text).toContain('Public commits authored');
    expect(fixture.nativeElement.querySelector('.github-card').textContent).toContain('10');
  });

  it('shows independent loading states without fake totals', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    const fixture = create();
    expect(fixture.nativeElement.querySelectorAll('[role="status"]')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.weekly-card').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(fixture.nativeElement.querySelectorAll('dd')).toHaveLength(0);
    fixture.destroy();
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it.each(['weekly', 'github'] as const)(
    'handles %s failures and retries only that resource',
    async (resource) => {
      vi.mocked(fetch).mockImplementation((path) =>
        Promise.resolve(
          String(path).endsWith(`/${resource}`)
            ? new Response('Service unavailable', { status: 503 })
            : Response.json(resource === 'weekly' ? github : recap),
        ),
      );
      const fixture = create();
      await settle(fixture);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('[role="alert"]')).toHaveLength(1);
      const otherCard = fixture.nativeElement.querySelector(
        resource === 'weekly' ? '.github-card' : '.weekly-card',
      ) as HTMLElement;
      expect(otherCard.textContent).not.toContain('Could not load');
      vi.mocked(fetch).mockResolvedValueOnce(Response.json(resource === 'weekly' ? recap : github));
      (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
      await settle(fixture);
      fixture.detectChanges();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(vi.mocked(fetch).mock.calls[2][0]).toBe(`/api/insights/${resource}`);
      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it('handles a rejected fetch without an unhandled promise failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));
    const fixture = create();
    await settle(fixture);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]')).toHaveLength(2);
  });

  it('shows the GitHub rate-limit error instead of hiding the cause', async () => {
    vi.mocked(fetch).mockImplementation((path) =>
      Promise.resolve(
        String(path).endsWith('/github')
          ? Response.json(
              {
                error: 'GitHub public commit search API failed (HTTP 403); rate limits may apply.',
              },
              { status: 502 },
            )
          : Response.json(recap),
      ),
    );
    const fixture = create();
    await settle(fixture);
    const card = fixture.nativeElement.querySelector('.github-card') as HTMLElement;
    expect(card.querySelector('[role="alert"]')?.textContent).toContain('rate limits may apply');
    expect(card.querySelector('button')?.textContent).toContain('Retry');
  });

  it.each([
    { resource: 'weekly', invalid: null, reason: 'null payload' },
    { resource: 'github', invalid: null, reason: 'null payload' },
    { resource: 'weekly', invalid: { activities: [] }, reason: 'unrelated payload' },
    { resource: 'github', invalid: { activities: [] }, reason: 'unrelated payload' },
    {
      resource: 'weekly',
      invalid: { ...recap, current: { ...recap.current, bySport: [null] } },
      reason: 'malformed totals',
    },
    { resource: 'github', invalid: { ...github, commits: '7' }, reason: 'malformed count' },
  ])(
    'shows a retryable $resource error for a successful response with $reason',
    async ({ resource, invalid }) => {
      vi.mocked(fetch).mockImplementation((path) =>
        Promise.resolve(
          Response.json(
            String(path).endsWith(`/${resource}`)
              ? invalid
              : resource === 'weekly'
                ? github
                : recap,
          ),
        ),
      );
      const fixture = create();
      await settle(fixture);
      const card = fixture.nativeElement.querySelector(`.${resource}-card`) as HTMLElement;
      expect(card.querySelector('[role="alert"]')?.textContent).toContain('Could not load');
      expect(card.querySelector('dd')).toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(Response.json(resource === 'weekly' ? recap : github));
      (card.querySelector('button') as HTMLButtonElement).click();
      await settle(fixture);
      expect(card.querySelector('[role="alert"]')).toBeNull();
      expect(card.querySelector('dd')).not.toBeNull();
    },
  );

  it('keeps weekly recaps available to AT Protocol users without calling GitHub', async () => {
    const fixture = create({ ...profile, id: 'did:plc:runner', provider: 'atproto' });
    await settle(fixture);
    fixture.detectChanges();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/insights/weekly');
    expect(fixture.nativeElement.textContent).toContain(recap.summary);
    expect(fixture.nativeElement.textContent).toContain('GitHub comparison needs a GitHub account');
    await fixture.componentInstance.retryGithub();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shows unavailable commits and public pushes, never substituting zero', async () => {
    vi.mocked(fetch).mockImplementation((path) =>
      Promise.resolve(
        Response.json(String(path).endsWith('/weekly') ? recap : { ...github, commits: null }),
      ),
    );
    const fixture = create();
    await settle(fixture);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.github-card') as HTMLElement;
    expect(card.querySelector('dd')?.textContent?.trim()).toBe('Unavailable');
    expect(card.textContent).toContain('3 public pushes');
    expect(card.textContent).toContain('private repositories');
    expect(card.textContent).toContain('No extra OAuth scopes');
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores stale-account responses that %s after a profile switch',
    async (outcome) => {
      const pending: Array<{
        resolve: (value: Response) => void;
        reject: (reason: Error) => void;
      }> = [];
      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise<Response>((resolve, reject) => {
            pending.push({ resolve, reject });
          }),
      );
      const fixture = create();
      const oldSignals = vi.mocked(fetch).mock.calls.map((call) => call[1]?.signal);
      fixture.componentRef.setInput('profile', {
        ...profile,
        id: 'did:plc:new',
        username: 'new-account',
        provider: 'atproto',
      });
      fixture.detectChanges();
      expect(oldSignals.every((signal) => signal?.aborted)).toBe(true);
      pending[2].resolve(Response.json({ ...recap, summary: 'Current account recap' }));
      await settle(fixture);
      for (const [index, request] of pending.slice(0, 2).entries()) {
        if (outcome === 'reject') request.reject(new Error('Old account error'));
        else
          request.resolve(
            Response.json(index === 0 ? { ...recap, summary: 'Old account recap' } : github),
          );
      }
      await settle(fixture);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Current account recap');
      expect(text).not.toContain('Old account');
      expect(text).not.toContain(github.username);
      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it('clears already loaded account data on input change before new requests complete', async () => {
    const fixture = create();
    await settle(fixture);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(recap.summary);
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    fixture.componentRef.setInput('profile', { ...profile, id: 'github-2', username: 'another' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(recap.summary);
    expect(fixture.nativeElement.textContent).not.toContain(`@${github.username}`);
    expect(fixture.nativeElement.querySelectorAll('[role="status"]')).toHaveLength(2);
    fixture.destroy();
  });
});
