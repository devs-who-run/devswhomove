import { describe, expect, it } from 'vitest';
import { joinWays, routeGroup, validRuns } from './osm-routes';

describe('OpenStreetMap routes', () => {
  it('joins ways that share end points, flipping reversed ways', () => {
    expect(
      joinWays([
        [
          [0, 1],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 2],
        ],
        [
          [0, 3],
          [0, 2],
        ],
        [
          [5, 5],
          [5, 6],
        ],
      ]),
    ).toEqual([
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
      ],
      [
        [5, 5],
        [5, 6],
      ],
    ]);
  });

  it('only looks up route types that suit the chosen sport', () => {
    expect(routeGroup(null)).toBe('all');
    expect(routeGroup('Running')).toBe('foot');
    expect(routeGroup('Walking')).toBe('foot');
    expect(routeGroup('Cycling')).toBe('bike');
    expect(routeGroup('Tennis')).toBeNull();
  });
});

describe('OpenStreetMap way geometry', () => {
  it('splits ways at missing or malformed positions and drops runs too short to draw', () => {
    expect(
      validRuns([
        { lat: 1, lon: 1 },
        { lat: 1, lon: 2 },
        null,
        { lat: 2, lon: 2 },
        { lat: 'x', lon: 3 },
        { lat: 3, lon: 3 },
        { lat: 3, lon: 4 },
        { lat: 95, lon: 4 },
      ]),
    ).toEqual([
      [
        [1, 1],
        [1, 2],
      ],
      [
        [3, 3],
        [3, 4],
      ],
    ]);
  });
});
