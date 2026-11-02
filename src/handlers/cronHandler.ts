import { CHUNK_SIZE_BYTES, MAX_CONCURRENT_MIGRATIONS, MAX_FILE_RETRIES, RETRY_COOLDOWN_MS } from '../constants';
import { buildSourceConfig } from '../lib/buildBucketConfigs';
import { s3ListObjects } from '../lib/s3Client';
import { getSetting, isCronEnabled } from '../lib/settings';
import type { QueueMessage } from '../types';

const QUEUE_SEND_BATCH_LIMIT = 100;
const DO_RESET_CONCURRENCY = 20;

export async function handleScheduled(env: Env): Promise<void> {
	const enabled = await isCronEnabled(env.MIGRATION_DB);
	if (!enabled) {
		console.log('[Cron] Auto-processing disabled, skipping');
		return;
	}

	await env.MIGRATION_DB.prepare(
		'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
	).bind('cron_last_ran', String(Math.floor(Date.now() / 1000))).run();

	const sourceConfig = buildSourceConfig(env);

	const { count: inProgressCount } = await env.MIGRATION_DB.prepare(
		'SELECT COUNT(*) as count FROM migrations WHERE status = ?',
	).bind('in_progress').first<{ count: number }>() ?? { count: 0 };


	const availableSlots = MAX_CONCURRENT_MIGRATIONS - inProgressCount;
	console.log(`[Cron] Available slots: ${availableSlots}`);
	let totalEnqueued = 0;

	const discoveryComplete = await getSetting(env.MIGRATION_DB, 'discovery_complete') === 'true';
	const discoveryCursor = await getSetting(env.MIGRATION_DB, 'discovery_cursor');

	if (availableSlots <= 0) {
		console.log(`[Cron] At capacity (${inProgressCount}/${MAX_CONCURRENT_MIGRATIONS} in-progress), skipping discovery`);
	} else {
		let continuationToken: string | null = null;
		let lastKey: string | null = null;

		do {
			const batchSize = Math.min(availableSlots - totalEnqueued, QUEUE_SEND_BATCH_LIMIT);
			const startAfter = !continuationToken ? discoveryCursor ?? undefined : undefined;
			const { objects, nextToken } = await s3ListObjects(sourceConfig, env.SOURCE_PREFIX, continuationToken ?? undefined, batchSize, startAfter);
			continuationToken = nextToken;

			const allKeys = objects.map(o => o.key);
			if (allKeys.length === 0) break;
			lastKey = allKeys[allKeys.length - 1];

			const placeholders = allKeys.map(() => '?').join(',');
			const existingRows = await env.MIGRATION_DB.prepare(
				`SELECT key FROM migrations WHERE key IN (${placeholders})`,
			).bind(...allKeys).all<{ key: string }>();
			const existingKeys = new Set(existingRows.results.map(r => r.key));
			const newObjects = objects.filter(o => !existingKeys.has(o.key));

			if (newObjects.length > 0) {
				if (discoveryComplete) {
					await env.MIGRATION_DB.prepare(
						'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
					).bind('discovery_complete', 'false').run();
					console.log(`[Cron] New files found after discovery complete, resuming full scan`);
				}

				const insertStatements = newObjects.map(obj => {
					const totalChunks = Math.ceil(obj.size / CHUNK_SIZE_BYTES);
					return env.MIGRATION_DB.prepare(
						'INSERT OR IGNORE INTO migrations (key, status, file_size, total_chunks) VALUES (?, ?, ?, ?)',
					).bind(obj.key, 'in_progress', obj.size, totalChunks);
				});
				await env.MIGRATION_DB.batch(insertStatements);
			}

			const pendingMessages: MessageSendRequest<QueueMessage>[] = newObjects.map(obj => ({
				body: { fileKey: obj.key, fileSize: obj.size },
			}));

			for (let i = 0; i < pendingMessages.length; i += QUEUE_SEND_BATCH_LIMIT) {
				const batch = pendingMessages.slice(i, i + QUEUE_SEND_BATCH_LIMIT);
				console.log(`[Cron] Sending batch: ${batch.length}`);
				await env.MIGRATION_QUEUE.sendBatch(batch);
			}

			totalEnqueued += pendingMessages.length;
			if (totalEnqueued >= availableSlots) break;
			if (discoveryComplete) break;
		} while (continuationToken);

		if (lastKey) {
			await env.MIGRATION_DB.prepare(
				'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
			).bind('discovery_cursor', lastKey).run();
		}

		if (!continuationToken && !discoveryComplete) {
			await env.MIGRATION_DB.batch([
				env.MIGRATION_DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('discovery_complete', 'true'),
				env.MIGRATION_DB.prepare('DELETE FROM settings WHERE key = ?').bind('discovery_cursor'),
			]);
			console.log('[Cron] Discovery complete — all source objects listed');
		}
	}

	const retried = await retryFailedMigrations(env);
	totalEnqueued += retried;

	if (totalEnqueued > 0) {
		console.log(`[Cron] Enqueued ${totalEnqueued} files for migration (${retried} retries)`);
	}
}

async function retryFailedMigrations(env: Env): Promise<number> {
	const cutoff = Math.floor((Date.now() - RETRY_COOLDOWN_MS) / 1000);

	const failed = await env.MIGRATION_DB.prepare(
		'SELECT key, file_size, total_chunks FROM migrations WHERE status = ? AND retry_count < ? AND (failed_at IS NULL OR failed_at < ?)',
	).bind('failed', MAX_FILE_RETRIES, cutoff).all<{ key: string; file_size: number; total_chunks: number }>();

	if (failed.results.length === 0) return 0;

	for (let i = 0; i < failed.results.length; i += DO_RESET_CONCURRENCY) {
		const batch = failed.results.slice(i, i + DO_RESET_CONCURRENCY);
		const results = await Promise.allSettled(
			batch.map(row => {
				const doId = env.MULTIPART_MIGRATOR.idFromName(row.key);
				const stub = env.MULTIPART_MIGRATOR.get(doId);
				return stub.fetch(new Request('https://do.internal/reset', { method: 'DELETE' }));
			}),
		);
		results.forEach((r, idx) => {
			if (r.status === 'rejected') {
				console.warn(`[Cron] Failed to reset DO for ${batch[idx].key}: ${r.reason}`);
			}
		});
	}

	const updateStatements = failed.results.map(row =>
		env.MIGRATION_DB.prepare(
			'UPDATE migrations SET status = ?, chunks_done = 0, failed_at = NULL, retry_count = retry_count + 1 WHERE key = ?',
		).bind('in_progress', row.key),
	);
	await env.MIGRATION_DB.batch(updateStatements);

	const pendingMessages: MessageSendRequest<QueueMessage>[] = failed.results.map(row => ({
		body: { fileKey: row.key, fileSize: row.file_size },
	}));

	for (let i = 0; i < pendingMessages.length; i += QUEUE_SEND_BATCH_LIMIT) {
		const batch = pendingMessages.slice(i, i + QUEUE_SEND_BATCH_LIMIT);
		await env.MIGRATION_QUEUE.sendBatch(batch);
	}

	return pendingMessages.length;
}
