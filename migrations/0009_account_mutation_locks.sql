CREATE TABLE account_mutation_locks (
  actor_id TEXT PRIMARY KEY,
  deleting INTEGER NOT NULL DEFAULT 0 CHECK (deleting IN (0, 1)),
  active_writes INTEGER NOT NULL DEFAULT 0 CHECK (active_writes >= 0)
);
