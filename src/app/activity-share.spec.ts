import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ActivityShare, mastodonHost, shareTargets } from './activity-share';
import { DEMO_ACTIVITIES } from './demo';

describe('activity sharing', () => {
  it('builds share intents for each network', () => {
    const url = 'https://devswhorun.dev/activities/at%3A%2F%2Fdid';
    const targets = Object.fromEntries(
      shareTargets(url, 'Run & done').map((target) => [target.name, target.href]),
    );
    expect(Object.keys(targets)).toEqual(['X', 'Bluesky', 'LinkedIn', 'Facebook', 'Threads']);
    expect(targets['X']).toBe(
      `https://x.com/intent/post?text=Run%20%26%20done&url=${encodeURIComponent(url)}`,
    );
    expect(targets['Bluesky']).toBe(
      `https://bsky.app/intent/compose?text=${encodeURIComponent(`Run & done ${url}`)}`,
    );
    expect(targets['LinkedIn']).toContain(`?url=${encodeURIComponent(url)}`);
  });

  it('accepts Mastodon servers and rejects anything else', () => {
    expect(mastodonHost('https://Mastodon.Social/')).toBe('mastodon.social');
    expect(mastodonHost('@ada@hachyderm.io')).toBe('hachyderm.io');
    expect(mastodonHost('javascript:alert(1)')).toBe('');
    expect(mastodonHost('evil.com/path?x')).toBe('evil.com');
    expect(mastodonHost('localhost')).toBe('');
  });

  it('uses the same versioned card URL for the preview and download', () => {
    const fixture = TestBed.createComponent(ActivityShare);
    fixture.componentRef.setInput('activity', { ...DEMO_ACTIVITIES[0], id: 'a/b' });
    fixture.detectChanges();
    const preview = fixture.nativeElement.querySelector('.share-preview') as HTMLImageElement;
    const download = fixture.nativeElement.querySelector('[download]') as HTMLAnchorElement;
    const url = preview.getAttribute('src');
    expect(url).toMatch(/^\/api\/activities\/a%2Fb\/card\.png\?v=\d+$/);
    expect(download.getAttribute('href')).toBe(url);
  });
});
