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

export interface ImportOptions {
  /**
   * When the provider's response was received. Strava rows record it as `fetched_at`, and an
   * older observation never overwrites a newer one.
   */
  observedAt?: string;
  /**
   * The Strava connection generation that produced these activities. Writes are dropped if that
   * connection was removed or replaced in the meantime, atomically with each write.
   */
  connection?: { athleteId: number; createdAt: string };
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
 * the same run from Garmin, Apple Health and Strava keeps only the first copy. A whole page is
 * one D1 batch, which counts as a single query toward D1's per-invocation limit; every guard is
 * evaluated inside the batch's transaction.
 */
export async function importActivities(
  db: D1Database,
  userId: string,
  source: ImportSource,
  items: readonly unknown[],
  options: ImportOptions = {},
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  const valid: {
    index: number;
    entry: {
      title: string;
      sport: string;
      occurredAt: string;
      duration: number;
      distance: number | null;
    };
    externalId: string | null;
  }[] = [];
  for (const [index, item] of items.entries()) {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new HttpError(400, 'Expected an activity object.');
      const data = item as Record<string, unknown>;
      const occurredAt = date(data['occurredAt'], false);
      const start = Date.parse(occurredAt);
      // The ±2-minute overlap window must be a representable date, or the whole batch would fail.
      if (
        !Number.isFinite(new Date(start - DUPLICATE_WINDOW_MS).getTime()) ||
        !Number.isFinite(new Date(start + DUPLICATE_WINDOW_MS).getTime())
      )
        throw new HttpError(400, 'Enter a valid date.');
      valid.push({
        index,
        entry: {
          title: text(data['title'], 'Title', 100),
          sport: sport(data['sport']),
          occurredAt,
          duration: number(data['duration'], 'Duration in minutes', 1, 1440),
          distance:
            data['distance'] == null ? null : number(data['distance'], 'Distance in km', 0, 2000),
        },
        externalId:
          data['externalId'] == null ? null : text(data['externalId'], 'External ID', 128),
      });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status >= 500) throw error;
      results.push({ index, status: 'invalid', error: error.message });
    }
  }
  if (!valid.length) return results.sort((a, b) => a.index - b.index);

  const strava = source === 'strava';
  // Strava rows may only be kept while Strava keeps returning them (see the 7-day purge).
  const observedAt = strava ? (options.observedAt ?? new Date().toISOString()) : null;

  // Guards shared by every write: the connection that fetched the data must still exist.
  const connectionGuard = options.connection
    ? {
        sql: 'AND EXISTS (SELECT 1 FROM strava_connections WHERE user_id = ? AND athlete_id = ? AND created_at = ?)',
        binds: [userId, options.connection.athleteId, options.connection.createdAt],
      }
    : { sql: '', binds: [] };
  const overlap = (sportName: string, occurredAt: string) => {
    const start = Date.parse(occurredAt);
    return [
      userId,
      sportName,
      new Date(start - DUPLICATE_WINDOW_MS).toISOString(),
      new Date(start + DUPLICATE_WINDOW_MS).toISOString(),
    ];
  };

  // Every decision is made from the rows' state inside the batch's transaction, not from an
  // earlier read: an existing copy (same provider ID) is refreshed, and the insert only runs when
  // no copy exists, so a row purged or created concurrently is handled correctly.
  const statements: D1PreparedStatement[] = [];
  const inserts: { index: number; id: string; statement: number }[] = [];
  for (const { index, entry, externalId } of valid) {
    const sameExternal = externalId
      ? {
          sql: 'AND NOT EXISTS (SELECT 1 FROM activities WHERE user_id = ? AND import_source = ? AND external_id = ?)',
          binds: [userId, source, externalId],
        }
      : { sql: '', binds: [] };
    if (strava && externalId) {
      // Seeing the activity again re-confirms it and picks up edits made on Strava, unless the
      // edit would make it overlap another activity, in which case the stored copy is kept.
      // A stale observation (older than the stored one) changes nothing.
      statements.push(
        db
          .prepare(
            `UPDATE activities SET title = ?, sport = ?, occurred_at = ?, duration = ?, distance = ?
            WHERE user_id = ? AND import_source = 'strava' AND external_id = ?
            AND (fetched_at IS NULL OR fetched_at <= ?)
            AND NOT EXISTS (
              SELECT 1 FROM activities other WHERE other.user_id = ? AND other.sport = ?
              AND other.occurred_at BETWEEN ? AND ? AND other.external_id IS NOT ?
            ) ${connectionGuard.sql}`,
          )
          .bind(
            entry.title,
            entry.sport,
            entry.occurredAt,
            entry.duration,
            entry.distance,
            userId,
            externalId,
            observedAt,
            ...overlap(entry.sport, entry.occurredAt),
            externalId,
            ...connectionGuard.binds,
          ),
        db
          .prepare(
            `UPDATE activities SET fetched_at = ?
            WHERE user_id = ? AND import_source = 'strava' AND external_id = ?
            AND (fetched_at IS NULL OR fetched_at <= ?) ${connectionGuard.sql}`,
          )
          .bind(observedAt, userId, externalId, observedAt, ...connectionGuard.binds),
      );
    }
    const id = crypto.randomUUID();
    // The overlap check is part of the INSERT so concurrent imports (a sync racing a webhook,
    // or two uploads) cannot both store the same workout. Strava activities the athlete
    // deleted here are not re-imported.
    const tombstone =
      strava && externalId
        ? {
            sql: 'AND NOT EXISTS (SELECT 1 FROM strava_deleted_activities WHERE user_id = ? AND external_id = ?)',
            binds: [userId, externalId],
          }
        : { sql: '', binds: [] };
    inserts.push({ index, id, statement: statements.length });
    statements.push(
      db
        .prepare(
          `INSERT INTO activities
          (id, user_id, title, sport, occurred_at, duration, distance, notes, visibility, source,
            payload_hash, import_source, external_id, fetched_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, '', 'private', 'web', ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM activities WHERE user_id = ? AND sport = ?
            AND occurred_at BETWEEN ? AND ?
          ) ${sameExternal.sql} ${tombstone.sql} ${connectionGuard.sql}
          ON CONFLICT DO NOTHING`,
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
          observedAt,
          ...overlap(entry.sport, entry.occurredAt),
          ...sameExternal.binds,
          ...tombstone.binds,
          ...connectionGuard.binds,
        ),
    );
  }
  // One batch per page: D1 counts a batch as a single query toward its per-invocation limit.
  const outcomes = await db.batch(statements);
  for (const { index, id, statement } of inserts)
    results.push(
      outcomes[statement]?.meta.changes
        ? { index, status: 'imported', id }
        : { index, status: 'duplicate' },
    );
  return results.sort((a, b) => a.index - b.index);
}

/** Summarise per-item results for API responses. */
export function importSummary(results: readonly ImportResult[]) {
  return {
    imported: results.filter((result) => result.status === 'imported').length,
    duplicates: results.filter((result) => result.status === 'duplicate').length,
    invalid: results.filter((result) => result.status === 'invalid').length,
  };
}
