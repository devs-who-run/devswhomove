import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeMovementChallenge } from './code-movement-challenge';
import type { Profile } from './models';

const profile: Profile = {
  id: 'alice',
  username: 'alice',
  name: 'Alice',
  avatar: '',
  bio: '',
  location: '',
  sports: [],
  visibility: 'private',
  provider: 'github',
};
const days = Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 9, 17 + index)).toISOString().slice(0, 10),
  moved: index === 26 || index === 27 || index === 28,
  commitFound: index === 25 || index === 27 || index === 28,
}));
const result = {
  period: { start: days[0].date, end: days[29].date },
  days,
  truncated: true,
};

describe('CodeMovementChallenge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads on demand and shows only confirmed days and the bounded streak', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
    const fixture = TestBed.createComponent(CodeMovementChallenge);
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
    expect(fetch).not.toHaveBeenCalled();
    await fixture.componentInstance.load();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelectorAll('.earned')).toHaveLength(2);
    expect(text).toContain('2 confirmed consecutive days');
    expect(text).toContain('Public commit not found');
    expect(text).toContain('does not mean you did not commit');
    expect(text).toContain('300-commit limit');
    expect(fetch).toHaveBeenCalledWith(
      '/api/insights/code-movement',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('shows errors and ignores an old account response after a profile change', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((r) => {
              resolve = r;
            }),
        )
        .mockResolvedValueOnce(new Response('failure', { status: 502 })),
    );
    const fixture = TestBed.createComponent(CodeMovementChallenge);
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
    const pending = fixture.componentInstance.load();
    fixture.componentRef.setInput('profile', { ...profile, id: 'new', username: 'new' });
    fixture.detectChanges();
    resolve(Response.json(result));
    await pending;
    expect(fixture.componentInstance.data()).toBeNull();
    await fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Could not load',
    );
    expect(fixture.nativeElement.querySelectorAll('.earned')).toHaveLength(0);
  });

  it('does not offer loading to AT Protocol accounts', () => {
    const fixture = TestBed.createComponent(CodeMovementChallenge);
    fixture.componentRef.setInput('profile', { ...profile, provider: 'atproto' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
});
