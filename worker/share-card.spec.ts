import { readFile } from 'node:fs/promises';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { describe, expect, it, vi } from 'vitest';
import {
  cardMetrics,
  cardSvg,
  cardVersion,
  recapCardSvg,
  recapMetrics,
  shareMeta,
  websiteShareTags,
  wrapText,
  type CardActivity,
} from './share-card';

const activity: CardActivity = {
  id: 'a1',
  name: 'Ada <Lovelace>',
  username: 'ada',
  title: 'Tempo & "hills" <script>alert(1)</script>',
  sport: 'Running',
  occurredAt: '2026-11-14T07:30:00Z',
  duration: 50,
  distance: 10,
};

describe('share card', () => {
  it('wraps long titles and ellipsizes overflow', () => {
    expect(wrapText('one two three four five six', 9, 2)).toEqual(['one two', 'three fo…']);
    expect(wrapText('short', 20, 2)).toEqual(['short']);
    expect(wrapText('a'.repeat(30), 10, 2)).toEqual(['aaaaaaaaa…']);
  });

  it('picks sport-specific metrics', () => {
    expect(cardMetrics(activity).map((metric) => [metric.label, metric.value])).toEqual([
      ['DISTANCE', '10'],
      ['MOVING TIME', '50'],
      ['AVG. PACE', '5:00'],
    ]);
    expect(cardMetrics({ ...activity, sport: 'Cycling', distance: 40, duration: 95 })).toEqual([
      { label: 'DISTANCE', value: '40', unit: 'km' },
      { label: 'MOVING TIME', value: '1h 35m', unit: '' },
      { label: 'AVG. SPEED', value: '25.3', unit: 'km/h' },
    ]);
    expect(cardMetrics({ ...activity, sport: 'Strength', distance: null })).toHaveLength(1);
  });

  it('escapes user content in the SVG', () => {
    const svg = cardSvg(activity, 'devswhorun.dev');
    expect(svg).toMatch(/^<svg [^>]*width="1200" height="630"/);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('Ada &lt;Lovelace&gt;');
  });

  it('renders the same logo as the site', async () => {
    const logo = await readFile('public/brand/icon.svg', 'utf8');
    const svg = cardSvg(activity, 'devswhorun.dev');
    expect(svg).toContain(`href="data:image/svg+xml,${encodeURIComponent(logo)}"`);

    await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
    const card = new Resvg(svg, {});
    const icon = new Resvg(logo, { fitTo: { mode: 'width', value: 52 } });
    try {
      const cardImage = card.render();
      const iconImage = icon.render();
      try {
        expect([iconImage.width, iconImage.height]).toEqual([52, 52]);
        const cardPixels = cardImage.pixels;
        const iconPixels = iconImage.pixels;
        let compared = 0;
        let mismatched = 0;
        for (let y = 2; y < 50; y++) {
          for (let x = 2; x < 50; x++) {
            const iconOffset = (y * 52 + x) * 4;
            if (iconPixels[iconOffset + 3] !== 255) continue;
            compared++;
            const cardOffset = ((y + 64) * 1200 + x + 72) * 4;
            if (
              [0, 1, 2, 3].some(
                (channel) => cardPixels[cardOffset + channel] !== iconPixels[iconOffset + channel],
              )
            )
              mismatched++;
          }
        }
        expect(compared).toBeGreaterThan(0);
        expect(mismatched).toBe(0);
      } finally {
        cardImage.free();
        iconImage.free();
      }
    } finally {
      card.free();
      icon.free();
    }
  });

  it('versions cards by rendered content', async () => {
    const version = await cardVersion(activity);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(await cardVersion({ ...activity })).toBe(version);
    expect(await cardVersion({ ...activity, title: 'Changed' })).not.toBe(version);
  });

  it('changes the card version when the logo changes', async () => {
    const version = await cardVersion(activity);
    vi.resetModules();
    vi.doMock('../public/brand/icon.svg?raw', () => ({ default: '<svg>Updated logo</svg>' }));
    try {
      const updated = await import('./share-card');
      expect(await updated.cardVersion(activity)).not.toBe(version);
    } finally {
      vi.doUnmock('../public/brand/icon.svg?raw');
      vi.resetModules();
    }
  });

  it('builds escaped OpenGraph and Twitter tags', () => {
    const meta = shareMeta(activity, 'https://devswhorun.dev', 'abc');
    expect(meta.tags).toContain(
      '<meta property="og:image" content="https://devswhorun.dev/api/activities/a1/card.png?v=abc" />',
    );
    expect(meta.tags).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(meta.tags).toContain('<meta property="og:image:width" content="1200" />');
    expect(meta.tags).not.toContain('<script>');
  });

  it('escapes the website preview URL', () => {
    const tags = websiteShareTags('https://devswhorun.dev', '/profile/a&b');
    expect(tags).toContain(
      '<meta property="og:url" content="https://devswhorun.dev/profile/a&amp;b" />',
    );
  });

  it('builds a valid, escaped Wrapped card with commits and kilometres', async () => {
    const recap = {
      kind: 'wrapped' as const,
      period: { start: '2026-01-01', end: '2026-12-31' },
      partial: false,
      totals: {
        sessions: 140,
        minutes: 9000,
        distanceKm: 800,
        activeDays: 120,
        bySport: [{ sport: 'Running' as const, sessions: 140, minutes: 9000, distanceKm: 800 }],
      },
      longestStreak: 12,
      commits: 1200,
      coverage: '',
      commitCoverage: '',
    };
    expect(recapMetrics(recap).map((metric) => metric.value)).toEqual([
      '1,200',
      '800',
      '140',
      '12',
    ]);
    expect(recapMetrics({ ...recap, commits: null })[0].label).toBe('DISTANCE');
    const svg = recapCardSvg(recap, { name: 'Ada <Dev>', username: 'ada&co' }, 'devswhorun.dev');
    expect(svg).toContain('2026 Wrapped');
    expect(svg).toContain('Ada &lt;Dev&gt;');
    expect(svg).toContain('@ada&amp;co');
    expect(svg).toContain('Top sport: Running');
    await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm')).catch(() => {});
    expect(() => new Resvg(svg, {}).render().free()).not.toThrow();
  });
});
