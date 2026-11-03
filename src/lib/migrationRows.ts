import { MS_PER_SECOND, STATUS_FAILED } from '../constants';

export function nowSeconds(): number {
	return Math.floor(Date.now() / MS_PER_SECOND);
}

// A minRetryCount of MAX_FILE_RETRIES uses up the file's automatic retries, so the cron won't restart it.
export function markFailedStatement(db: D1Database, where: string, minRetryCount: number, ...whereParams: unknown[]): D1PreparedStatement {
	return db.prepare(
		`UPDATE migrations SET status = ?, failed_at = ?, retry_count = MAX(COALESCE(retry_count, 0), ?), throttle_attempts = 0, next_retry_at = NULL WHERE ${where}`,
	).bind(STATUS_FAILED, nowSeconds(), minRetryCount, ...whereParams);
}
