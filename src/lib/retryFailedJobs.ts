import { STATUS_FAILED, STATUS_QUEUED } from '../constants';
import { resetMigrators } from './durableObjects';

// Parks jobs as queued instead of sending them, so the cron feeds them in within the concurrency limit.
export async function retryFailedJobs(env: Env): Promise<number> {
	const failed = await env.MIGRATION_DB.prepare(
		'SELECT key FROM migrations WHERE status = ?',
	).bind(STATUS_FAILED).all<{ key: string }>();

	if (failed.results.length === 0) return 0;

	const keys = failed.results.map(row => row.key);
	const reset = await resetMigrators(env, keys);
	reset.failed.forEach(key => console.warn(`[RetryFailed] Failed to reset DO for ${key}`));

	await env.MIGRATION_DB.batch(keys.map(key =>
		env.MIGRATION_DB.prepare(
			'UPDATE migrations SET status = ?, chunks_done = 0, retry_count = 0, failed_at = NULL WHERE key = ? AND status = ?',
		).bind(STATUS_QUEUED, key, STATUS_FAILED),
	));

	return keys.length;
}
