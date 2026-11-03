CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('cron_enabled', 'false');
INSERT INTO settings (key, value) VALUES ('cron_last_ran', '0');
