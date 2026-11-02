CREATE TABLE migrations (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'in_progress',
  file_size INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  chunks_done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE INDEX idx_migrations_status ON migrations(status);
