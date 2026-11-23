import { describe, expect, it } from 'vitest';
import {
  appleWorkout,
  parseAppleHealth,
  parseFit,
  parseGpx,
  parseImportFile,
  parseTcx,
} from './activity-import-parsers';

const FIT_EPOCH = 631_065_600;

// jsdom's Blob lacks stream(), which every supported browser provides.
if (!('stream' in Blob.prototype))
  Object.defineProperty(Blob.prototype, 'stream', {
    value(this: Blob) {
      return new ReadableStream<Uint8Array>({
        start: async (controller) => {
          controller.enqueue(new Uint8Array(await this.arrayBuffer()));
          controller.close();
        },
      });
    },
  });

/** Build a minimal FIT file with a Garmin file_id message and one session message. */
function fitFile(session: { start: string; sport: number; timerMs: number; distanceCm: number }) {
  const bytes: number[] = [];
  const u16 = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff);
  const u32 = (value: number) =>
    bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
  // file_id definition (local 0, global 0): manufacturer uint16.
  bytes.push(0x40, 0, 0);
  u16(0);
  bytes.push(1, 1, 2, 0x84);
  bytes.push(0x00);
  u16(1);
  // session definition (local 1, global 18): start_time, sport, timer, distance.
  bytes.push(0x41, 0, 0);
  u16(18);
  bytes.push(4, 2, 4, 0x86, 5, 1, 0x00, 8, 4, 0x86, 9, 4, 0x86);
  bytes.push(0x01);
  u32(Date.parse(session.start) / 1000 - FIT_EPOCH);
  bytes.push(session.sport);
  u32(session.timerMs);
  u32(session.distanceCm);
  const header = [
    14,
    0x20,
    0,
    0,
    ...[0, 0, 0, 0],
    ...'.FIT'.split('').map((c) => c.charCodeAt(0)),
    0,
    0,
  ];
  const view = new DataView(new Uint8Array(header).buffer);
  view.setUint32(4, bytes.length, true);
  return new Uint8Array([...new Uint8Array(view.buffer), ...bytes, 0, 0]).buffer;
}

/** Build a stored (uncompressed) ZIP archive. */
function zip(files: Record<string, string | ArrayBuffer>): Blob {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? encoder.encode(content) : new Uint8Array(content);
    const nameBytes = encoder.encode(name);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    local.push(new Uint8Array(header.buffer), nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
}

const stream = (text: string, chunk = 7) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text);
      for (let index = 0; index < bytes.length; index += chunk)
        controller.enqueue(bytes.slice(index, index + chunk));
      controller.close();
    },
  });

const healthXml = `<?xml version="1.0"?><HealthData>
  <Record type="HKQuantityTypeIdentifierHeartRate" value="72" startDate="2026-01-01 06:00:00 +0000"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="31.5" durationUnit="min"
    totalDistance="3.1" totalDistanceUnit="mi" sourceName="Watch" startDate="2026-01-02 07:00:00 +0100"
    endDate="2026-01-02 07:31:30 +0100">
    <MetadataEntry key="HKIndoorWorkout" value="0"/>
    <WorkoutRoute sourceName="Watch"><FileReference path="/workout-routes/route.gpx"/></WorkoutRoute>
  </Workout>
  <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45"
    durationUnit="min" startDate="2026-01-03 18:00:00 -0500"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="3600" durationUnit="s"
    startDate="2026-01-04 08:00:00 +0000">
    <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="140" unit="count/min"/>
    <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceCycling" sum="25.4" unit="km"/>
  </Workout>
  <Workout workoutActivityType="HKWorkoutActivityTypeYoga" duration="0.5" durationUnit="min"
    startDate="2026-01-05 08:00:00 +0000"/>
</HealthData>`;

describe('activity import parsers', () => {
  it('reads a GPX track without keeping its route', () => {
    const result = parseGpx(`<?xml version="1.0"?>
      <gpx creator="Garmin Connect" xmlns="http://www.topografix.com/GPX/1/1"><trk>
        <name>Canal loop</name><type>running</type><trkseg>
          <trkpt lat="51.5000" lon="-0.1200"><time>2026-02-01T07:00:00Z</time></trkpt>
          <trkpt lat="51.5090" lon="-0.1200"><time>2026-02-01T07:06:00Z</time></trkpt>
        </trkseg></trk></gpx>`);
    expect(result.activities).toEqual([
      {
        title: 'Canal loop',
        sport: 'Running',
        occurredAt: '2026-02-01T07:00:00.000Z',
        duration: 6,
        distance: 1.001,
        source: 'garmin',
      },
    ]);
  });

  it('sums TCX laps', () => {
    const result = parseTcx(`<?xml version="1.0"?>
      <TrainingCenterDatabase><Activities><Activity Sport="Biking">
        <Id>2026-02-03T17:00:00Z</Id>
        <Lap StartTime="2026-02-03T17:00:00Z"><TotalTimeSeconds>900</TotalTimeSeconds><DistanceMeters>6000</DistanceMeters></Lap>
        <Lap StartTime="2026-02-03T17:15:00Z"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>4000</DistanceMeters></Lap>
      </Activity></Activities></TrainingCenterDatabase>`);
    expect(result.activities).toMatchObject([
      { sport: 'Cycling', duration: 25, distance: 10, title: 'Ride', source: 'file' },
    ]);
  });

  it('reads FIT session summaries and recognises Garmin devices', () => {
    const result = parseFit(
      fitFile({ start: '2026-02-05T06:30:00Z', sport: 5, timerMs: 1_800_000, distanceCm: 150_000 }),
    );
    expect(result.activities).toEqual([
      {
        title: 'Swim',
        sport: 'Swimming',
        occurredAt: '2026-02-05T06:30:00.000Z',
        duration: 30,
        distance: 1.5,
        source: 'garmin',
      },
    ]);
    expect(() => parseFit(new ArrayBuffer(20))).toThrow('not a FIT file');
  });

  it('streams Apple Health workouts across chunk boundaries and converts units', async () => {
    const result = await parseAppleHealth(stream(healthXml));
    expect(result.activities).toEqual([
      {
        title: 'Run',
        sport: 'Running',
        occurredAt: '2026-01-02T06:00:00.000Z',
        duration: 31.5,
        distance: 4.989,
        source: 'apple-health',
      },
      {
        title: 'Strength session',
        sport: 'Strength',
        occurredAt: '2026-01-03T23:00:00.000Z',
        duration: 45,
        distance: null,
        source: 'apple-health',
      },
      {
        title: 'Ride',
        sport: 'Cycling',
        occurredAt: '2026-01-04T08:00:00.000Z',
        duration: 60,
        distance: 25.4,
        source: 'apple-health',
      },
    ]);
    expect(result.skipped).toBe(1);
  });

  it('names other Apple workout types from their identifier', () => {
    expect(
      appleWorkout(
        '<Workout workoutActivityType="HKWorkoutActivityTypeHighIntensityIntervalTraining" duration="20" durationUnit="min" startDate="2026-01-01 08:00:00 +0000"/>',
      ),
    ).toMatchObject({ sport: 'Other', title: 'High Intensity Interval Training' });
  });

  it('prefers export.xml in an Apple Health archive and ignores its route files', async () => {
    const file = new File(
      [
        zip({
          'apple_health_export/export.xml': healthXml,
          'apple_health_export/workout-routes/route.gpx': '<gpx/>',
        }),
      ],
      'export.zip',
    );
    const result = await parseImportFile(file);
    expect(result.activities.map((activity) => activity.sport)).toEqual([
      'Running',
      'Strength',
      'Cycling',
    ]);
    expect(result.ignoredFiles).toBe(1);
  });

  it('reads every workout file in a Garmin export archive', async () => {
    const file = new File(
      [
        zip({
          'DI_CONNECT/one.fit': fitFile({
            start: '2026-02-06T06:30:00Z',
            sport: 1,
            timerMs: 1_500_000,
            distanceCm: 500_000,
          }),
          'DI_CONNECT/readme.txt': 'not a workout',
        }),
      ],
      'garmin.zip',
    );
    const result = await parseImportFile(file);
    expect(result.activities).toMatchObject([{ sport: 'Running', distance: 5, source: 'garmin' }]);
    expect(result.ignoredFiles).toBe(1);
  });

  it('rejects unsupported files', async () => {
    await expect(parseImportFile(new File(['x'], 'notes.txt'))).rejects.toThrow('not a FIT');
  });
});
