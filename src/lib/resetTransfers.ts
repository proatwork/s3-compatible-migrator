import { STATUS_COMPLETED, STATUS_SKIPPED } from '../constants';
import { resetMigrators } from './durableObjects';
import { resetDiscovery, setSetting, SETTING_CRON_ENABLED } from './settings';

// Pauses first, so jobs still in the queue are dropped instead of starting. Completed Durable Objects clean up after themselves.
export async function resetTransfers(env: Env): Promise<number> {
	await setSetting(env.MIGRATION_DB, SETTING_CRON_ENABLED, 'false');

	const rows = await env.MIGRATION_DB.prepare(
		'SELECT key FROM migrations WHERE status NOT IN (?, ?)',
	).bind(STATUS_COMPLETED, STATUS_SKIPPED).all<{ key: string }>();

	const reset = await resetMigrators(env, rows.results.map(row => row.key));

	// Deleting the row of a job that didn't stop would leave it running with nothing tracking it. Running reset again is safe.
	if (reset.failed.length > 0) throw new Error(`Could not stop ${reset.failed.length} transfers`);

	await env.MIGRATION_DB.prepare('DELETE FROM migrations').run();
	await resetDiscovery(env.MIGRATION_DB);

	return reset.succeeded.length;
}
