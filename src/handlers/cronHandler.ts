import {
	CHUNK_SIZE_BYTES,
	MAX_CONCURRENT_MIGRATIONS,
	MAX_DISCOVERY_PAGES_PER_RUN,
	MAX_FILE_RETRIES,
	MS_PER_SECOND,
	RETRY_COOLDOWN_MS,
	STALE_JOB_SECONDS,
	STATUS_FAILED,
	STATUS_IN_PROGRESS,
	STATUS_QUEUED,
	STATUS_SKIPPED,
	STATUS_THROTTLED,
} from '../constants';
import { buildSourceConfig } from '../lib/buildBucketConfigs';
import { s3ListObjects } from '../lib/s3Client';
import { resetMigrators } from '../lib/durableObjects';
import { nowSeconds } from '../lib/migrationRows';
import { skipReason } from '../lib/skipRules';
import {
	getSetting,
	isCronEnabled,
	SETTING_CRON_LAST_RAN,
	SETTING_DISCOVERY_COMPLETE,
	SETTING_DISCOVERY_CURSOR,
	settingStatement,
	writeSetting,
} from '../lib/settings';
import type { QueueMessage } from '../types';

const QUEUE_SEND_BATCH_LIMIT = 100;

export async function handleScheduled(env: Env): Promise<void> {
	const enabled = await isCronEnabled(env.MIGRATION_DB);
	if (!enabled) {
		console.log('[Cron] Paused, skipping');
		return;
	}

	await writeSetting(env.MIGRATION_DB, SETTING_CRON_LAST_RAN, String(nowSeconds()));

	const sourceConfig = buildSourceConfig(env);

	await requeueStaleJobs(env);

	// Starting more work would only make the throttling worse. The age check means a stuck row can't block this forever.
	const { count: throttledCount } = await env.MIGRATION_DB.prepare(
		'SELECT COUNT(*) as count FROM migrations WHERE status = ? AND COALESCE(next_retry_at, 0) > ?',
	).bind(STATUS_THROTTLED, nowSeconds() - STALE_JOB_SECONDS).first<{ count: number }>() ?? { count: 0 };

	if (throttledCount > 0) {
		console.log(`[Cron] ${throttledCount} jobs throttled, not starting new work`);
		return;
	}

	const { count: inProgressCount } = await env.MIGRATION_DB.prepare(
		'SELECT COUNT(*) as count FROM migrations WHERE status IN (?, ?)',
	).bind(STATUS_IN_PROGRESS, STATUS_THROTTLED).first<{ count: number }>() ?? { count: 0 };

	const requeued = await requeueHeldJobs(env, MAX_CONCURRENT_MIGRATIONS - inProgressCount);
	const retried = await retryFailedMigrations(env, MAX_CONCURRENT_MIGRATIONS - inProgressCount - requeued);
	const availableSlots = MAX_CONCURRENT_MIGRATIONS - inProgressCount - requeued - retried;
	console.log(`[Cron] Available slots: ${availableSlots}`);
	let totalEnqueued = 0;

	const discoveryComplete = await getSetting(env.MIGRATION_DB, SETTING_DISCOVERY_COMPLETE) === 'true';
	const discoveryCursor = await getSetting(env.MIGRATION_DB, SETTING_DISCOVERY_CURSOR);

	if (availableSlots <= 0) {
		console.log(`[Cron] At capacity (${inProgressCount}/${MAX_CONCURRENT_MIGRATIONS} in-progress), skipping discovery`);
	} else {
		let continuationToken: string | null = null;
		let lastKey: string | null = null;
		let pagesScanned = 0;

		do {
			const batchSize = Math.min(availableSlots - totalEnqueued, QUEUE_SEND_BATCH_LIMIT);
			const startAfter = !continuationToken ? discoveryCursor ?? undefined : undefined;
			const { objects, nextToken } = await s3ListObjects(sourceConfig, env.SOURCE_PREFIX, continuationToken ?? undefined, batchSize, startAfter);
			continuationToken = nextToken;

			// Pause or Reset may have landed during the listing.
			if (!(await isCronEnabled(env.MIGRATION_DB))) return;

			const allKeys = objects.map(o => o.key);
			if (allKeys.length === 0) break;
			lastKey = allKeys[allKeys.length - 1];

			const placeholders = allKeys.map(() => '?').join(',');
			const existingRows = await env.MIGRATION_DB.prepare(
				`SELECT key FROM migrations WHERE key IN (${placeholders})`,
			).bind(...allKeys).all<{ key: string }>();
			const existingKeys = new Set(existingRows.results.map(r => r.key));
			const newObjects = objects.filter(o => !existingKeys.has(o.key));
			const classified = newObjects.map(obj => ({ obj, reason: skipReason(obj.key, obj.size) }));

			if (newObjects.length > 0) {
				if (discoveryComplete) {
					await writeSetting(env.MIGRATION_DB, SETTING_DISCOVERY_COMPLETE, 'false');
					console.log(`[Cron] New files found after discovery complete, resuming full scan`);
				}

				// Skipped files get a row so they're shown and never picked up again, but they don't take a slot.
				const insertStatements = classified.map(({ obj, reason }) => {
					const totalChunks = Math.ceil(obj.size / CHUNK_SIZE_BYTES);
					return env.MIGRATION_DB.prepare(
						'INSERT OR IGNORE INTO migrations (key, status, file_size, total_chunks, skip_reason) VALUES (?, ?, ?, ?, ?)',
					).bind(obj.key, reason ? STATUS_SKIPPED : STATUS_IN_PROGRESS, obj.size, totalChunks, reason);
				});
				await env.MIGRATION_DB.batch(insertStatements);
			}

			const copyable = classified.filter(({ reason }) => !reason).map(({ obj }) => obj);
			await enqueueJobs(env, copyable.map(obj => ({ fileKey: obj.key, fileSize: obj.size })));

			totalEnqueued += copyable.length;
			pagesScanned++;
			if (totalEnqueued >= availableSlots) break;
			if (pagesScanned >= MAX_DISCOVERY_PAGES_PER_RUN) break;
		} while (continuationToken);

		if (lastKey) {
			await writeSetting(env.MIGRATION_DB, SETTING_DISCOVERY_CURSOR, lastKey);
		}

		// Clearing the cursor makes the next run start over, so files added anywhere in the source get found.
		if (!continuationToken) {
			await env.MIGRATION_DB.batch([
				settingStatement(env.MIGRATION_DB, SETTING_DISCOVERY_COMPLETE, 'true'),
				env.MIGRATION_DB.prepare('DELETE FROM settings WHERE key = ?').bind(SETTING_DISCOVERY_CURSOR),
			]);
			if (!discoveryComplete) console.log('[Cron] Discovery complete — all source objects listed');
		}
	}

	totalEnqueued += retried + requeued;

	if (totalEnqueued > 0) {
		console.log(`[Cron] Enqueued ${totalEnqueued} files for migration (${retried} retries, ${requeued} resumed)`);
	}
}

async function enqueueJobs(env: Env, jobs: QueueMessage[]): Promise<void> {
	for (let i = 0; i < jobs.length; i += QUEUE_SEND_BATCH_LIMIT) {
		const batch = jobs.slice(i, i + QUEUE_SEND_BATCH_LIMIT).map(body => ({ body }));
		console.log(`[Cron] Sending batch: ${batch.length}`);
		await env.MIGRATION_QUEUE.sendBatch(batch);
	}
}

// A row can end up in progress with no queue message if a send or a D1 write fails. Sending another is safe: a running job ignores it.
async function requeueStaleJobs(env: Env): Promise<void> {
	const now = nowSeconds();
	const stale = await env.MIGRATION_DB.prepare(
		`SELECT key, file_size FROM migrations
		 WHERE (status = ? AND COALESCE(updated_at, created_at) < ?) OR (status = ? AND COALESCE(next_retry_at, 0) < ?)
		 LIMIT ?`,
	).bind(STATUS_IN_PROGRESS, now - STALE_JOB_SECONDS, STATUS_THROTTLED, now - STALE_JOB_SECONDS, QUEUE_SEND_BATCH_LIMIT).all<{ key: string; file_size: number }>();

	if (stale.results.length === 0) return;

	await env.MIGRATION_DB.batch(stale.results.map(row =>
		env.MIGRATION_DB.prepare('UPDATE migrations SET updated_at = ? WHERE key = ?').bind(now, row.key),
	));
	await enqueueJobs(env, stale.results.map(row => ({ fileKey: row.key, fileSize: row.file_size })));
	console.log(`[Cron] Requeued ${stale.results.length} stale jobs`);
}

async function requeueHeldJobs(env: Env, slots: number): Promise<number> {
	if (slots <= 0) return 0;

	const held = await env.MIGRATION_DB.prepare(
		'SELECT key, file_size FROM migrations WHERE status = ? LIMIT ?',
	).bind(STATUS_QUEUED, slots).all<{ key: string; file_size: number }>();

	if (held.results.length === 0) return 0;

	const now = nowSeconds();
	await env.MIGRATION_DB.batch(held.results.map(row =>
		env.MIGRATION_DB.prepare('UPDATE migrations SET status = ?, updated_at = ? WHERE key = ?').bind(STATUS_IN_PROGRESS, now, row.key),
	));
	await enqueueJobs(env, held.results.map(row => ({ fileKey: row.key, fileSize: row.file_size })));

	return held.results.length;
}

async function retryFailedMigrations(env: Env, slots: number): Promise<number> {
	if (slots <= 0) return 0;

	const cutoff = nowSeconds() - RETRY_COOLDOWN_MS / MS_PER_SECOND;

	const failed = await env.MIGRATION_DB.prepare(
		'SELECT key, file_size, total_chunks FROM migrations WHERE status = ? AND retry_count < ? AND (failed_at IS NULL OR failed_at < ?) LIMIT ?',
	).bind(STATUS_FAILED, MAX_FILE_RETRIES, cutoff, slots).all<{ key: string; file_size: number; total_chunks: number }>();

	if (failed.results.length === 0) return 0;

	const reset = await resetMigrators(env, failed.results.map(row => row.key));
	reset.failed.forEach(key => console.warn(`[Cron] Failed to reset DO for ${key}`));

	const updateStatements = failed.results.map(row =>
		env.MIGRATION_DB.prepare(
			'UPDATE migrations SET status = ?, chunks_done = 0, failed_at = NULL, retry_count = retry_count + 1, updated_at = ? WHERE key = ?',
		).bind(STATUS_IN_PROGRESS, nowSeconds(), row.key),
	);
	await env.MIGRATION_DB.batch(updateStatements);

	await enqueueJobs(env, failed.results.map(row => ({ fileKey: row.key, fileSize: row.file_size })));

	return failed.results.length;
}
