import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityRoute } from './activity-route';

describe('ActivityRoute', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never draws a route fetched for a different activity', async () => {
    const pending = new Map<string, (segments: number[][][]) => void>();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (path: string) =>
          new Promise<Response>((resolve) =>
            pending.set(path, (segments) => resolve(Response.json({ segments }))),
          ),
      ),
    );
    const fixture = TestBed.createComponent(ActivityRoute);
    const route = fixture.componentInstance;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
    };
    const line = (lat: number) => [
      [
        [lat, 0],
        [lat + 0.01, 0.01],
      ],
    ];
    fixture.componentRef.setInput('activityId', 'a');
    fixture.detectChanges();
    pending.get('/api/activities/a/route')!(line(52));
    await settle();
    expect(route.drawing()?.paths).toHaveLength(1);

    fixture.componentRef.setInput('activityId', 'b');
    fixture.detectChanges();
    expect(route.drawing()).toBeNull();

    // A late response for the previous activity is ignored.
    fixture.componentRef.setInput('activityId', 'c');
    fixture.detectChanges();
    pending.get('/api/activities/b/route')!(line(40));
    await settle();
    expect(route.drawing()).toBeNull();
  });

  it('prefers preview segments over a fetched route', () => {
    vi.stubGlobal('fetch', vi.fn());
    const fixture = TestBed.createComponent(ActivityRoute);
    fixture.componentRef.setInput('activityId', 'a');
    fixture.componentRef.setInput('segments', [
      [
        [1, 1],
        [1.01, 1],
      ],
    ]);
    fixture.detectChanges();
    expect(fetch).not.toHaveBeenCalled();
    expect(fixture.componentInstance.drawing()?.paths).toHaveLength(1);
  });
});
