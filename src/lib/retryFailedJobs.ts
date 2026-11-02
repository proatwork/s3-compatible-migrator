import type { QueueMessage } from '../types';

const DO_RESET_CONCURRENCY = 20;
const QUEUE_SEND_BATCH_LIMIT = 100;

export async function retryFailedJobs(env: Env): Promise<number> {
	const failed = await env.MIGRATION_DB.prepare(
		'SELECT key, file_size, total_chunks FROM migrations WHERE status = ?',
	).bind('failed').all<{ key: string; file_size: number; total_chunks: number }>();

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
				console.warn(`[RetryFailed] Failed to reset DO for ${batch[idx].key}: ${r.reason}`);
			}
		});
	}

	const updateStatements = failed.results.map(row =>
		env.MIGRATION_DB.prepare(
			'UPDATE migrations SET status = ?, chunks_done = 0, retry_count = 0, failed_at = NULL WHERE key = ?',
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

	return failed.results.length;
}
