import { describe, expect, it } from 'vitest';
import { RouteImport } from './route-import';

const gpx = `<gpx><trk><type>walking</type><trkseg>
  <trkpt lat="1" lon="1"><time>2026-02-01T07:00:00Z</time></trkpt>
  <trkpt lat="1.01" lon="1"><time>2026-02-01T07:20:00Z</time></trkpt>
</trkseg></trk></gpx>`;

describe('RouteImport', () => {
  it('ignores a failure from a file that was replaced before it finished', async () => {
    const routeImport = new RouteImport();
    const stale = routeImport.load(new File(['<gpx/>'], 'empty.gpx'));
    const current = routeImport.load(new File([gpx], 'walk.gpx'));
    await expect(stale).resolves.toBeNull();
    await expect(current).resolves.toMatchObject({ sport: 'Walking', duration: 20 });
    expect(routeImport.fileName()).toBe('walk.gpx');
    expect(routeImport.hasTrack()).toBe(true);
    expect(routeImport.busy()).toBe(false);
  });

  it('still reports a failure for the current file', async () => {
    const routeImport = new RouteImport();
    await expect(routeImport.load(new File(['<gpx/>'], 'empty.gpx'))).rejects.toThrow('No workout');
    expect(routeImport.busy()).toBe(false);
  });
});
