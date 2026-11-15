import { describe, expect, it } from 'vitest';
import { mastodonHost, shareTargets } from './activity-share';

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
});
