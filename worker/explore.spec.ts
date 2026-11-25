import { describe, expect, it } from 'vitest';
import { boundingBox, distanceKm } from './explore';

describe('explore bounding boxes', () => {
  it('uses one longitude interval away from the antimeridian', () => {
    const box = boundingBox({ lat: 52.52, lng: 13.4 }, 25);
    expect(box.lngRanges).toHaveLength(1);
    const [[west, east]] = box.lngRanges;
    expect(west).toBeLessThan(13.4);
    expect(east).toBeGreaterThan(13.4);
  });

  it('splits into two intervals when the search crosses the antimeridian', () => {
    const near = { lat: -16.5, lng: 179.95 };
    const box = boundingBox(near, 25);
    expect(box.lngRanges).toHaveLength(2);
    const across = { lat: -16.5, lng: -179.95 };
    expect(distanceKm(near, across)).toBeLessThan(25);
    expect(box.lngRanges.some(([min, max]) => across.lng >= min && across.lng <= max)).toBe(true);
    expect(box.lngRanges.some(([min, max]) => near.lng >= min && near.lng <= max)).toBe(true);
  });

  it('covers every longitude near a pole', () => {
    expect(boundingBox({ lat: 89.95, lng: 0 }, 25).lngRanges).toEqual([[-180, 180]]);
  });
});
