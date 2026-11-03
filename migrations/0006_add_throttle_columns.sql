ALTER TABLE migrations ADD COLUMN throttle_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE migrations ADD COLUMN next_retry_at INTEGER;
ALTER TABLE migrations ADD COLUMN updated_at INTEGER;
