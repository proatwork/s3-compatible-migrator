export const CHUNK_SIZE_BYTES = 50 * 1024 * 1024;

export const MAX_PARTS_PER_UPLOAD = 10_000;

export const MAX_COPYABLE_FILE_BYTES = CHUNK_SIZE_BYTES * MAX_PARTS_PER_UPLOAD;

export const CHUNKS_PER_ALARM_CYCLE = 3;

export const ALARM_CYCLE_DELAY_MS = 300;

export const MAX_CHUNK_RETRIES = 3;

export const AUTO_CLEANUP_DELAY_MS = 60 * 1000;

export const MAX_FILE_RETRIES = 3;

export const RETRY_COOLDOWN_MS = 30 * 1000;

export const MAX_CONCURRENT_MIGRATIONS = 1000;

export const SOURCE_FILES_PAGE_SIZE = 10;

export const MAX_DISCOVERY_PAGES_PER_RUN = 10;

export const STATUS_IN_PROGRESS = 'in_progress';

export const STATUS_COMPLETED = 'completed';

export const STATUS_FAILED = 'failed';

export const STATUS_SKIPPED = 'skipped';

export const STATUS_QUEUED = 'queued';

export const STATUS_THROTTLED = 'throttled';

export const THROTTLE_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 30_000, 45_000, 60_000];

export const STALE_JOB_SECONDS = 600;

export const DO_CALL_CONCURRENCY = 20;

export const DO_BASE_URL = 'https://do.internal';

export const HTTP_NOT_FOUND = 404;

export const MS_PER_SECOND = 1000;

export const SETTING_CRON_ENABLED = 'cron_enabled';

export const SETTING_CRON_LAST_RAN = 'cron_last_ran';

export const SETTING_DISCOVERY_COMPLETE = 'discovery_complete';

export const SETTING_DISCOVERY_CURSOR = 'discovery_cursor';
