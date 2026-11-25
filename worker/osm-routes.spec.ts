import { describe, expect, it } from 'vitest';
import { joinWays, routeGroup } from './osm-routes';

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
