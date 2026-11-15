import { describe, expect, it } from 'vitest';
import {
  cardMetrics,
  cardSvg,
  cardVersion,
  shareMeta,
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

  it('versions cards by rendered content', async () => {
    const version = await cardVersion(activity);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(await cardVersion({ ...activity })).toBe(version);
    expect(await cardVersion({ ...activity, title: 'Changed' })).not.toBe(version);
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
});
