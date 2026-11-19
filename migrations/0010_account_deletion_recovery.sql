ALTER TABLE account_mutation_locks ADD COLUMN remote_cleanup_started INTEGER NOT NULL DEFAULT 0
  CHECK (remote_cleanup_started IN (0, 1));
ALTER TABLE account_mutation_reservations ADD COLUMN kind TEXT NOT NULL DEFAULT 'mutation'
  CHECK (kind IN ('mutation', 'export'));
CREATE INDEX account_mutation_reservations_exports ON account_mutation_reservations(kind, actor_id, lease_until);
ALTER TABLE photo_deletions ADD COLUMN actor_id TEXT;
ALTER TABLE photo_deletions ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
CREATE INDEX photo_deletions_due ON photo_deletions(next_attempt_at);

CREATE TABLE account_deletion_guard (
  owned INTEGER NOT NULL CHECK (owned = 1)
);

ALTER TABLE account_deletion_jobs RENAME TO account_deletion_jobs_old;
CREATE TABLE account_deletion_jobs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  encrypted_oauth_session TEXT NOT NULL,
  created_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL
);
INSERT INTO account_deletion_jobs (id, actor_id, encrypted_oauth_session, created_at, next_attempt_at)
  SELECT actor_id, actor_id, encrypted_oauth_session, created_at, created_at
  FROM account_deletion_jobs_old WHERE encrypted_oauth_session IS NOT NULL;
DROP TABLE account_deletion_jobs_old;
CREATE INDEX account_deletion_jobs_due ON account_deletion_jobs(next_attempt_at, created_at);
