import type { Sport } from './models';

/**
 * Browser-side readers for workout exports. Only a summary of each workout (sport, start time,
 * duration and distance) leaves the device; GPS tracks, heart rate and other health samples are
 * read and discarded here.
 */
export type FileImportSource = 'garmin' | 'apple-health' | 'file';

export interface ParsedActivity {
  title: string;
  sport: Sport;
  occurredAt: string;
  /** Minutes. */
  duration: number;
  /** Kilometres. */
  distance: number | null;
  source: FileImportSource;
}

export interface ParseResult {
  activities: ParsedActivity[];
  /** Workouts that were found but cannot be stored (too short, too long, or undated). */
  skipped: number;
  /** Files in an archive that were not workouts. */
  ignoredFiles: number;
}

export type ProgressCallback = (message: string) => void;

// The DOM typings declare these transforms as accepting any BufferSource; byte streams are fine.
const decompress = (stream: ReadableStream<Uint8Array>, format: 'gzip' | 'deflate-raw') =>
  stream.pipeThrough(
    new DecompressionStream(format) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
const decodeText = (stream: ReadableStream<Uint8Array>) =>
  stream.pipeThrough(
    new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>,
  );

const SPORT_LABELS: Record<Sport, string> = {
  Running: 'Run',
  Cycling: 'Ride',
  Tennis: 'Tennis',
  Walking: 'Walk',
  Swimming: 'Swim',
  Strength: 'Strength session',
  Other: 'Workout',
};

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Accept only workouts the API can store: 1 minute to 24 hours, at most 2,000 km, not future. */
function finish(
  partial: Omit<ParsedActivity, 'title'> & { title?: string },
): ParsedActivity | null {
  const start = Date.parse(partial.occurredAt);
  if (!Number.isFinite(start) || start > Date.now() + 60_000) return null;
  if (!Number.isFinite(partial.duration) || partial.duration < 1 || partial.duration > 1440)
    return null;
  const distance =
    partial.distance != null && Number.isFinite(partial.distance) && partial.distance > 0
      ? Math.min(round(partial.distance, 3), 2000)
      : null;
  return {
    ...partial,
    title: (partial.title?.trim() || SPORT_LABELS[partial.sport]).slice(0, 100),
    occurredAt: new Date(start).toISOString(),
    duration: round(partial.duration, 2),
    distance,
  };
}

/** Map free-text sport names used by GPX/TCX exporters. */
export function sportFromText(value: string | null | undefined): Sport {
  const text = (value ?? '').toLowerCase();
  if (/run|jog/.test(text)) return 'Running';
  if (/bik|cycl|ride/.test(text)) return 'Cycling';
  if (/walk|hik/.test(text)) return 'Walking';
  if (/swim/.test(text)) return 'Swimming';
  if (/tennis/.test(text)) return 'Tennis';
  if (/strength|weight/.test(text)) return 'Strength';
  return 'Other';
}

// ---------------------------------------------------------------------------------------------
// GPX and TCX

function haversineKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const xml = (text: string) => {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length)
    throw new Error('This file is not valid XML.');
  return document;
};

// Match by local name in any namespace so both `trkpt` and prefixed `gpx:trkpt` elements work.
const byTag = (root: Document | Element, name: string) => [
  ...root.getElementsByTagNameNS('*', name),
];
const childText = (root: Document | Element, name: string) =>
  root.getElementsByTagNameNS('*', name)[0]?.textContent?.trim() ?? '';

/** A track point's position, or null when lat/lon are missing or out of range. */
function coordinates(point: Element): [number, number] | null {
  const lat = point.getAttribute('lat');
  const lon = point.getAttribute('lon');
  if (lat === null || lon === null || !lat.trim() || !lon.trim()) return null;
  const position: [number, number] = [Number(lat), Number(lon)];
  const [latitude, longitude] = position;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return position;
}

export function parseGpx(text: string): ParseResult {
  const document = xml(text);
  const garmin = /garmin/i.test(document.documentElement.getAttribute('creator') ?? '');
  const result: ParseResult = { activities: [], skipped: 0, ignoredFiles: 0 };
  for (const track of byTag(document, 'trk')) {
    let distance = 0;
    let first = NaN;
    let last = NaN;
    // Segments are separate recordings (e.g. a paused watch); no distance is added between them.
    const segments = byTag(track, 'trkseg');
    for (const segment of segments.length ? segments : [track]) {
      let previous: [number, number] | null = null;
      for (const point of byTag(segment, 'trkpt')) {
        const position = coordinates(point);
        if (position) {
          if (previous) distance += haversineKm(previous, position);
          previous = position;
        }
        const time = Date.parse(childText(point, 'time'));
        if (Number.isFinite(time)) {
          if (!Number.isFinite(first)) first = time;
          last = time;
        }
      }
    }
    const activity = Number.isFinite(first)
      ? finish({
          title: childText(track, 'name'),
          sport: sportFromText(childText(track, 'type')),
          occurredAt: new Date(first).toISOString(),
          duration: (last - first) / 60_000,
          distance,
          source: garmin ? 'garmin' : 'file',
        })
      : null;
    if (activity) result.activities.push(activity);
    else result.skipped++;
  }
  return result;
}

export function parseTcx(text: string): ParseResult {
  const document = xml(text);
  // TCX is Garmin's format, so the namespace says nothing; the creator names the device.
  const garmin = /garmin|forerunner|f[eē]nix|edge|venu|vivoactive|instinct|epix|enduro/i.test(
    childText(document, 'Creator'),
  );
  const result: ParseResult = { activities: [], skipped: 0, ignoredFiles: 0 };
  for (const element of byTag(document, 'Activity')) {
    const laps = byTag(element, 'Lap');
    const seconds = laps.reduce((sum, lap) => sum + Number(childText(lap, 'TotalTimeSeconds')), 0);
    const meters = laps.reduce(
      (sum, lap) =>
        sum +
        Number(
          [...lap.children].find((child) => child.localName === 'DistanceMeters')?.textContent ?? 0,
        ),
      0,
    );
    const start = childText(element, 'Id') || laps[0]?.getAttribute('StartTime') || '';
    const activity = finish({
      title: childText(element, 'Notes'),
      sport: sportFromText(element.getAttribute('Sport')),
      occurredAt: start,
      duration: seconds / 60,
      distance: meters / 1000,
      source: garmin ? 'garmin' : 'file',
    });
    if (activity) result.activities.push(activity);
    else result.skipped++;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// FIT (Garmin and most watches)

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH = 631_065_600;

interface FitField {
  number: number;
  size: number;
}

interface FitDefinition {
  littleEndian: boolean;
  global: number;
  fields: FitField[];
  developerBytes: number;
}

function fitSport(sport: number, subSport: number): Sport {
  if (sport === 1) return 'Running';
  if (sport === 2) return 'Cycling';
  if (sport === 5) return 'Swimming';
  if (sport === 8) return 'Tennis';
  if (sport === 11 || sport === 17) return 'Walking';
  if (sport === 10 && subSport === 20) return 'Strength';
  return 'Other';
}

/** Read session summaries from a FIT activity file. */
export function parseFit(buffer: ArrayBuffer): ParseResult {
  const view = new DataView(buffer);
  const result: ParseResult = { activities: [], skipped: 0, ignoredFiles: 0 };
  if (view.byteLength < 12) throw new Error('This FIT file is too short.');
  const headerSize = view.getUint8(0);
  const dataSize = view.getUint32(4, true);
  const signature = String.fromCharCode(...new Uint8Array(buffer, 8, 4));
  if (signature !== '.FIT') throw new Error('This is not a FIT file.');
  const end = Math.min(headerSize + dataSize, view.byteLength);
  const definitions = new Map<number, FitDefinition>();
  let manufacturer = -1;
  let offset = headerSize;

  const read = (position: number, size: number, littleEndian: boolean): number => {
    if (size === 1) return view.getUint8(position);
    if (size === 2) return view.getUint16(position, littleEndian);
    if (size === 4) return view.getUint32(position, littleEndian);
    return NaN;
  };

  while (offset < end) {
    const header = view.getUint8(offset++);
    if (header & 0x80) {
      // Compressed timestamp header: a data message for local types 0-3.
      const definition = definitions.get((header >> 5) & 0x03);
      if (!definition) throw new Error('This FIT file is damaged.');
      offset += definition.fields.reduce((sum, field) => sum + field.size, 0);
      offset += definition.developerBytes;
      continue;
    }
    const local = header & 0x0f;
    if (header & 0x40) {
      const littleEndian = view.getUint8(offset + 1) === 0;
      const global = view.getUint16(offset + 2, littleEndian);
      const count = view.getUint8(offset + 4);
      offset += 5;
      const fields: FitField[] = [];
      for (let index = 0; index < count; index++, offset += 3)
        fields.push({ number: view.getUint8(offset), size: view.getUint8(offset + 1) });
      let developerBytes = 0;
      if (header & 0x20) {
        const developerCount = view.getUint8(offset++);
        for (let index = 0; index < developerCount; index++, offset += 3)
          developerBytes += view.getUint8(offset + 1);
      }
      definitions.set(local, { littleEndian, global, fields, developerBytes });
      continue;
    }
    const definition = definitions.get(local);
    if (!definition) throw new Error('This FIT file is damaged.');
    const values = new Map<number, number>();
    for (const field of definition.fields) {
      values.set(field.number, read(offset, field.size, definition.littleEndian));
      offset += field.size;
    }
    offset += definition.developerBytes;
    if (definition.global === 0) manufacturer = values.get(1) ?? -1;
    if (definition.global !== 18) continue;
    const valid = (value: number | undefined, invalid: number) =>
      value != null && value !== invalid && Number.isFinite(value) ? value : NaN;
    const start = valid(values.get(2), 0xffffffff);
    const timer = valid(values.get(8), 0xffffffff);
    const elapsed = valid(values.get(7), 0xffffffff);
    const distance = valid(values.get(9), 0xffffffff);
    const sport = fitSport(valid(values.get(5), 0xff), valid(values.get(6), 0xff));
    const activity = finish({
      sport,
      occurredAt: Number.isFinite(start) ? new Date((start + FIT_EPOCH) * 1000).toISOString() : '',
      duration: (Number.isFinite(timer) ? timer : elapsed) / 60_000,
      distance: Number.isFinite(distance) ? distance / 100_000 : null,
      source: 'file',
    });
    if (activity) result.activities.push(activity);
    else result.skipped++;
  }
  // Manufacturer 1 is Garmin in the FIT profile.
  if (manufacturer === 1) for (const activity of result.activities) activity.source = 'garmin';
  return result;
}

// ---------------------------------------------------------------------------------------------
// Apple Health export.xml

const APPLE_SPORTS: Record<string, Sport> = {
  Running: 'Running',
  Cycling: 'Cycling',
  HandCycling: 'Cycling',
  Walking: 'Walking',
  Hiking: 'Walking',
  Swimming: 'Swimming',
  Tennis: 'Tennis',
  TraditionalStrengthTraining: 'Strength',
  FunctionalStrengthTraining: 'Strength',
};

const KM_PER_UNIT: Record<string, number> = {
  km: 1,
  m: 0.001,
  mi: 1.609344,
  yd: 0.0009144,
  ft: 0.0003048,
};

const MINUTES_PER_UNIT: Record<string, number> = { min: 1, s: 1 / 60, h: 60, hr: 60 };

/** Apple writes dates as `2024-01-01 07:00:00 +0100`. */
function appleDate(value: string | undefined): string {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value ?? '');
  return match ? `${match[1]}T${match[2]}${match[3]}:${match[4]}` : (value ?? '');
}

function attributes(tag: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(/([A-Za-z]+)="([^"]*)"/g)) values[name] = value;
  return values;
}

/** Convert one `<Workout …>…</Workout>` element into an activity. */
export function appleWorkout(element: string): ParsedActivity | null {
  const open = element.slice(0, element.indexOf('>') + 1);
  const workout = attributes(open);
  const type = (workout['workoutActivityType'] ?? '').replace('HKWorkoutActivityType', '');
  const sport = APPLE_SPORTS[type] ?? 'Other';
  let distance =
    Number(workout['totalDistance']) * (KM_PER_UNIT[workout['totalDistanceUnit']] ?? NaN);
  if (!(distance > 0)) {
    // iOS 16+ records distance as WorkoutStatistics children instead of attributes.
    for (const [statistic] of element.matchAll(/<WorkoutStatistics [^>]*>/g)) {
      const values = attributes(statistic);
      if (!values['type']?.startsWith('HKQuantityTypeIdentifierDistance')) continue;
      distance = Number(values['sum']) * (KM_PER_UNIT[values['unit']] ?? NaN);
      break;
    }
  }
  const label =
    sport === 'Other' ? type.replace(/([a-z])([A-Z])/g, '$1 $2') || 'Workout' : SPORT_LABELS[sport];
  return finish({
    title: type === 'Hiking' ? 'Hike' : label,
    sport,
    occurredAt: appleDate(workout['startDate']),
    duration:
      Number(workout['duration']) * (MINUTES_PER_UNIT[workout['durationUnit'] ?? 'min'] ?? NaN),
    distance: Number.isFinite(distance) ? distance : null,
    source: 'apple-health',
  });
}

/**
 * Stream Apple Health's export.xml, which can be several gigabytes, and keep only workouts.
 * The file is never held in memory; only the current workout element is buffered.
 */
export async function parseAppleHealth(
  stream: ReadableStream<Uint8Array>,
  progress?: ProgressCallback,
): Promise<ParseResult> {
  const result: ParseResult = { activities: [], skipped: 0, ignoredFiles: 0 };
  const reader = decodeText(stream).getReader();
  let buffer = '';
  let scanned = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += value;
      scanned += value.length;
    }
    for (;;) {
      const start = buffer.indexOf('<Workout ');
      if (start < 0) {
        // Keep a tail in case `<Workout ` is split across chunks.
        buffer = buffer.slice(-16);
        break;
      }
      const openEnd = buffer.indexOf('>', start);
      if (openEnd < 0) {
        buffer = buffer.slice(start);
        break;
      }
      let end = buffer[openEnd - 1] === '/' ? openEnd + 1 : buffer.indexOf('</Workout>', openEnd);
      if (end < 0) {
        buffer = buffer.slice(start);
        break;
      }
      if (buffer[openEnd - 1] !== '/') end += '</Workout>'.length;
      const activity = appleWorkout(buffer.slice(start, end));
      if (activity) result.activities.push(activity);
      else result.skipped++;
      buffer = buffer.slice(end);
    }
    if (progress && scanned > 50_000_000) {
      scanned = 0;
      progress(`Reading Apple Health export… ${result.activities.length} workouts so far`);
    }
    if (done) break;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// ZIP archives (Garmin and Strava account exports, Apple Health export.zip)

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

async function bytes(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

/** Read a ZIP's central directory without loading the archive into memory. */
export async function zipEntries(file: Blob): Promise<ZipEntry[]> {
  const tailSize = Math.min(file.size, 65_557);
  const tail = await bytes(file.slice(file.size - tailSize));
  let eocd = -1;
  for (let index = tail.byteLength - 22; index >= 0; index--)
    if (tail.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  if (eocd < 0) throw new Error('This ZIP file is damaged or incomplete.');
  let count = tail.getUint16(eocd + 10, true);
  let size = tail.getUint32(eocd + 12, true);
  let offset = tail.getUint32(eocd + 16, true);
  if (offset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (locator < 0 || tail.getUint32(locator, true) !== 0x07064b50)
      throw new Error('This ZIP64 archive is not supported.');
    const record = Number(tail.getBigUint64(locator + 8, true));
    const zip64 = await bytes(file.slice(record, record + 56));
    count = Number(zip64.getBigUint64(32, true));
    size = Number(zip64.getBigUint64(40, true));
    offset = Number(zip64.getBigUint64(48, true));
  }
  const directory = await bytes(file.slice(offset, offset + size));
  const entries: ZipEntry[] = [];
  let position = 0;
  for (let index = 0; index < count && position + 46 <= directory.byteLength; index++) {
    if (directory.getUint32(position, true) !== 0x02014b50) break;
    const method = directory.getUint16(position + 10, true);
    let compressedSize = directory.getUint32(position + 20, true);
    const uncompressedSize = directory.getUint32(position + 24, true);
    const nameLength = directory.getUint16(position + 28, true);
    const extraLength = directory.getUint16(position + 30, true);
    const commentLength = directory.getUint16(position + 32, true);
    let localOffset = directory.getUint32(position + 42, true);
    const name = new TextDecoder().decode(
      new Uint8Array(directory.buffer, directory.byteOffset + position + 46, nameLength),
    );
    // ZIP64 extra field: values are present only for header fields set to 0xFFFFFFFF.
    let extra = position + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let cursor = extra + 4;
        if (uncompressedSize === 0xffffffff) cursor += 8;
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(directory.getBigUint64(cursor, true));
          cursor += 8;
        }
        if (localOffset === 0xffffffff) localOffset = Number(directory.getBigUint64(cursor, true));
      }
      extra += 4 + length;
    }
    entries.push({ name, method, compressedSize, localOffset });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function zipStream(file: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const header = await bytes(file.slice(entry.localOffset, entry.localOffset + 30));
  if (header.getUint32(0, true) !== 0x04034b50) throw new Error('This ZIP file is damaged.');
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const raw = file.slice(start, start + entry.compressedSize).stream();
  if (entry.method === 0) return raw;
  if (entry.method === 8) return decompress(raw, 'deflate-raw');
  throw new Error(`${entry.name} uses an unsupported ZIP compression method.`);
}

const streamBlob = async (stream: ReadableStream<Uint8Array>) => new Response(stream).blob();

const extension = (name: string) => /\.(fit|gpx|tcx|xml)(\.gz)?$/i.exec(name);
const isZip = (name: string) => /\.zip$/i.test(name);

async function parseWorkoutFile(
  name: string,
  stream: ReadableStream<Uint8Array>,
  progress?: ProgressCallback,
): Promise<ParseResult> {
  const match = extension(name);
  if (!match) return { activities: [], skipped: 0, ignoredFiles: 1 };
  const decoded = match[2] ? decompress(stream, 'gzip') : stream;
  const type = match[1].toLowerCase();
  if (type === 'xml') {
    if (!/(^|\/)export\.xml$/i.test(name)) return { activities: [], skipped: 0, ignoredFiles: 1 };
    return parseAppleHealth(decoded, progress);
  }
  const blob = await streamBlob(decoded);
  if (type === 'fit') return parseFit(await blob.arrayBuffer());
  const text = await blob.text();
  return type === 'gpx' ? parseGpx(text) : parseTcx(text);
}

function merge(target: ParseResult, next: ParseResult): void {
  target.activities.push(...next.activities);
  target.skipped += next.skipped;
  target.ignoredFiles += next.ignoredFiles;
}

/**
 * Read a single upload: a FIT/GPX/TCX file (optionally gzipped), Apple Health's export.xml, or a
 * ZIP containing any of those.
 */
export async function parseImportFile(
  file: File,
  progress?: ProgressCallback,
): Promise<ParseResult> {
  const result: ParseResult = { activities: [], skipped: 0, ignoredFiles: 0 };
  if (!/\.zip$/i.test(file.name)) {
    if (!extension(file.name))
      throw new Error(`${file.name} is not a FIT, GPX, TCX, Apple Health or ZIP export.`);
    merge(result, await parseWorkoutFile(file.name, file.stream(), progress));
    return result;
  }
  await parseArchive(file, file.name, result, progress, true);
  return result;
}

/**
 * Read workouts from a ZIP. A Garmin account backup keeps its activities in nested
 * `UploadedFiles_*.zip` archives, so ZIPs inside the top-level archive are read one level deep.
 */
async function parseArchive(
  archive: Blob,
  label: string,
  result: ParseResult,
  progress: ProgressCallback | undefined,
  outer: boolean,
): Promise<void> {
  const entries = (await zipEntries(archive)).filter((entry) => !entry.name.endsWith('/'));
  const health = entries.find((entry) => /(^|\/)export\.xml$/i.test(entry.name));
  // Apple Health archives also contain route GPX files that duplicate their workouts.
  const workouts = health ? [health] : entries.filter((entry) => extension(entry.name));
  const nested = health || !outer ? [] : entries.filter((entry) => isZip(entry.name));
  result.ignoredFiles += entries.length - workouts.length - nested.length;
  for (const [index, entry] of workouts.entries()) {
    if (!health && index % 25 === 0)
      progress?.(`Reading ${label}… ${index} of ${workouts.length} files`);
    try {
      merge(result, await parseWorkoutFile(entry.name, await zipStream(archive, entry), progress));
    } catch {
      result.ignoredFiles++;
    }
  }
  for (const entry of nested) {
    const name = entry.name.split('/').at(-1) ?? entry.name;
    progress?.(`Opening ${name}…`);
    try {
      await parseArchive(
        await streamBlob(await zipStream(archive, entry)),
        name,
        result,
        progress,
        false,
      );
    } catch {
      result.ignoredFiles++;
    }
  }
}
