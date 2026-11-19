CREATE TABLE account_deletion_failures (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  failure_code TEXT NOT NULL CHECK (failure_code IN (
    'revocation_unsupported',
    'revocation_expired'
  )),
  recorded_at TEXT NOT NULL,
  delete_after TEXT NOT NULL
);
CREATE INDEX account_deletion_failures_expiry ON account_deletion_failures(delete_after);
