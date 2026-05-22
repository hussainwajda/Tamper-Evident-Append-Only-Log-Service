CREATE TABLE IF NOT EXISTS log_entries (
  id SERIAL PRIMARY KEY,
  ulid TEXT UNIQUE NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  prev_hash TEXT,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_log_entries_created_at
  ON log_entries (created_at);

CREATE INDEX IF NOT EXISTS idx_log_entries_actor
  ON log_entries (actor);
