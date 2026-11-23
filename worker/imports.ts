import { HttpError, date, number, sport, text } from './validation';

export const IMPORT_SOURCES = ['strava', 'garmin', 'apple-health', 'file'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** Imports from files may only claim a file-based source; `strava` is reserved for the API sync. */
export const FILE_IMPORT_SOURCES: readonly ImportSource[] = ['garmin', 'apple-health', 'file'];

export const MAX_IMPORT_BATCH = 200;

/** Two recordings of the same workout (e.g. a watch and the phone) start within this window. */
const DUPLICATE_WINDOW_MS = 2 * 60_000;

export interface ImportResult {
  index: number;
  status: 'imported' | 'duplicate' | 'invalid';
  id?: string;
  error?: string;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Store imported activity summaries for a GitHub account.
 *
 * Imports are always private, carry no notes or GPS data, and are de-duplicated both by the
 * provider's own ID and by a same-sport activity that starts within two minutes, so importing
 * the same run from Garmin, Apple Health and Strava keeps only the first copy.
 */
export async function importActivities(
  db: D1Database,
  userId: string,
  source: ImportSource,
  items: readonly unknown[],
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const [index, item] of items.entries()) {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new HttpError(400, 'Expected an activity object.');
      const data = item as Record<string, unknown>;
      const entry = {
        title: text(data['title'], 'Title', 100),
        sport: sport(data['sport']),
        occurredAt: date(data['occurredAt'], false),
        duration: number(data['duration'], 'Duration in minutes', 1, 1440),
        distance:
          data['distance'] == null ? null : number(data['distance'], 'Distance in km', 0, 2000),
      };
      const externalId =
        data['externalId'] == null ? null : text(data['externalId'], 'External ID', 128);
      if (externalId) {
        const existing = await db
          .prepare(
            'SELECT id FROM activities WHERE user_id = ? AND import_source = ? AND external_id = ?',
          )
          .bind(userId, source, externalId)
          .first<{ id: string }>();
        if (existing) {
          results.push({ index, status: 'duplicate', id: existing.id });
          continue;
        }
      }
      const start = Date.parse(entry.occurredAt);
      const overlapping = await db
        .prepare(
          `SELECT id FROM activities WHERE user_id = ? AND sport = ?
          AND occurred_at BETWEEN ? AND ? LIMIT 1`,
        )
        .bind(
          userId,
          entry.sport,
          new Date(start - DUPLICATE_WINDOW_MS).toISOString(),
          new Date(start + DUPLICATE_WINDOW_MS).toISOString(),
        )
        .first<{ id: string }>();
      if (overlapping) {
        results.push({ index, status: 'duplicate', id: overlapping.id });
        continue;
      }
      const id = crypto.randomUUID();
      const inserted = await db
        .prepare(
          `INSERT INTO activities
          (id, user_id, title, sport, occurred_at, duration, distance, notes, visibility, source,
            payload_hash, import_source, external_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, '', 'private', 'web', ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .bind(
          id,
          userId,
          entry.title,
          entry.sport,
          entry.occurredAt,
          entry.duration,
          entry.distance,
          await sha256(JSON.stringify(entry)),
          source,
          externalId,
        )
        .run();
      results.push(
        inserted.meta.changes ? { index, status: 'imported', id } : { index, status: 'duplicate' },
      );
    } catch (error) {
      if (!(error instanceof HttpError) || error.status >= 500) throw error;
      results.push({ index, status: 'invalid', error: error.message });
    }
  }
  return results;
}

/** Summarise per-item results for API responses. */
export function importSummary(results: readonly ImportResult[]) {
  return {
    imported: results.filter((result) => result.status === 'imported').length,
    duplicates: results.filter((result) => result.status === 'duplicate').length,
    invalid: results.filter((result) => result.status === 'invalid').length,
  };
}
