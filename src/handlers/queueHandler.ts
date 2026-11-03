import { DO_BASE_URL, STATUS_IN_PROGRESS, STATUS_QUEUED, STATUS_SKIPPED, STATUS_THROTTLED } from '../constants';
import { migratorStub, resetMigrators } from '../lib/durableObjects';
import { isCronEnabled } from '../lib/settings';
import { skipReason } from '../lib/skipRules';
import type { QueueMessage } from '../types';

export async function handleQueue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
	// While paused, hold jobs that haven't started in D1, since queue messages would run out of retries. The cron requeues them.
	if (!(await isCronEnabled(env.MIGRATION_DB))) {
		await env.MIGRATION_DB.batch(batch.messages.map(message =>
			env.MIGRATION_DB.prepare('UPDATE migrations SET status = ? WHERE key = ? AND status = ?')
				.bind(STATUS_QUEUED, message.body.fileKey, STATUS_IN_PROGRESS),
		));
		batch.ackAll();
		console.log(`[Queue] Paused, holding ${batch.messages.length} jobs`);
		return;
	}

	// A job aborted or reset while its message waited in the queue must not start.
	const placeholders = batch.messages.map(() => '?').join(',');
	const active = await env.MIGRATION_DB.prepare(
		`SELECT key FROM migrations WHERE status IN (?, ?) AND key IN (${placeholders})`,
	).bind(STATUS_IN_PROGRESS, STATUS_THROTTLED, ...batch.messages.map(message => message.body.fileKey)).all<{ key: string }>();
	const activeKeys = new Set(active.results.map(row => row.key));

	await Promise.allSettled(
		batch.messages.map(async (message) => {
			if (!activeKeys.has(message.body.fileKey)) {
				message.ack();
				return;
			}

			try {
				const { fileKey, fileSize } = message.body;

				// Rows created before the skip rules existed can still reach the queue. Resetting stops a copy that already started.
				const reason = skipReason(fileKey, fileSize);
				if (reason) {
					await resetMigrators(env, [fileKey]);
					await env.MIGRATION_DB.prepare('UPDATE migrations SET status = ?, skip_reason = ? WHERE key = ?')
						.bind(STATUS_SKIPPED, reason, fileKey).run();
					console.warn(`[Queue] ${fileKey} skipped: ${reason}`);
					message.ack();
					return;
				}

				console.log(`[Queue] ${fileKey} is now being transferred (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
				const job: QueueMessage = { fileKey, fileSize };

				const response = await migratorStub(env, fileKey).fetch(new Request(`${DO_BASE_URL}/migrate`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(job),
				}));

				if (response.ok) {
					console.log(`[Queue] ${fileKey} migration started`);
					message.ack();
				} else {
					console.error(`[Queue] DO rejected migration for ${fileKey}: ${response.status}`);
					message.retry();
				}
			} catch (error) {
				console.error(`[Queue] Failed to dispatch migration for ${message.body.fileKey}: ${(error as Error).message}`);
				message.retry();
			}
		}),
	);
}
