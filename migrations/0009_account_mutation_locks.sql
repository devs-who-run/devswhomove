CREATE TABLE account_mutation_locks (
  actor_id TEXT PRIMARY KEY,
  deleting INTEGER NOT NULL DEFAULT 0 CHECK (deleting IN (0, 1)),
  deletion_attempt_id TEXT,
  deletion_lease_until TEXT,
  generation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE account_mutation_reservations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES account_mutation_locks(actor_id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  lease_until TEXT NOT NULL
);
CREATE INDEX account_mutation_reservations_actor ON account_mutation_reservations(actor_id, lease_until);

CREATE TABLE account_deletion_jobs (
  actor_id TEXT PRIMARY KEY,
  encrypted_oauth_session TEXT,
  created_at TEXT NOT NULL
);
