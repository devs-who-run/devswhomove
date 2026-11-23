import { describe, expect, it } from 'vitest';
import {
  distanceMeters,
  drawRoute,
  shareableRoute,
  simplifyRoute,
  trimPrivacyZones,
  type TrackPoint,
} from './route-geometry';

/** A straight run due north from (52, 0): one point every ~11 m, every 4 seconds. */
function straightTrack(count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    lat: 52 + index * 0.0001,
    lng: 0,
    time: Date.UTC(2026, 10, 20, 7, 0, 0) + index * 4000,
  }));
}

describe('route geometry', () => {
  it('measures great-circle distance', () => {
    expect(distanceMeters({ lat: 52, lng: 0 }, { lat: 53, lng: 0 })).toBeCloseTo(111_195, -1);
  });

  it('removes points near the start and end, including when a loop passes by again', () => {
    const out = straightTrack(200);
    const loop = [...out, ...out.slice().reverse(), ...out];
    const segments = trimPrivacyZones(loop, 200);
    const allPoints = segments.flat();
    expect(allPoints.length).toBeGreaterThan(0);
    for (const [lat, lng] of allPoints) {
      expect(distanceMeters({ lat, lng }, loop[0])).toBeGreaterThanOrEqual(200);
      expect(distanceMeters({ lat, lng }, loop.at(-1)!)).toBeGreaterThanOrEqual(200);
    }
    // Passing the start again mid-route splits the line.
    expect(segments.length).toBeGreaterThan(1);
  });

  it('returns no route when the whole track is inside the privacy zones', () => {
    expect(shareableRoute(straightTrack(30), 500)).toEqual([]);
  });

  it('simplifies long routes to the point budget', () => {
    const zigzag: [number, number][] = Array.from({ length: 5000 }, (_, index) => [
      52 + index * 0.0001,
      (index % 2) * 0.001,
    ]);
    const simplified = simplifyRoute([zigzag], 500);
    expect(simplified.flat().length).toBeLessThanOrEqual(500);
    expect(simplified[0][0]).toEqual([52, 0]);
    // A straight line collapses to its end points.
    expect(simplifyRoute([straightTrack(100).map((p) => [p.lat, p.lng])])[0]).toHaveLength(2);
  });

  it('draws routes inside the SVG box', () => {
    const drawing = drawRoute(
      [
        [
          [52, 0],
          [52.01, 0.01],
        ],
      ],
      320,
      160,
      10,
    );
    expect(drawing.paths).toHaveLength(1);
    expect(drawing.paths[0]).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
    for (const [x, y] of [drawing.start!, drawing.end!]) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(310);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(150);
    }
    // North is up: the later, more northern point is higher on screen.
    expect(drawing.end![1]).toBeLessThan(drawing.start![1]);
    expect(drawRoute([]).paths).toEqual([]);
  });
});
