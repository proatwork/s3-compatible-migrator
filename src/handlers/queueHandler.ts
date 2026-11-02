import { buildDestinationConfig, buildSourceConfig } from '../lib/buildBucketConfigs';
import type { MigrationJob, QueueMessage } from '../types';

export async function handleQueue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
	const sourceConfig = buildSourceConfig(env);
	const destConfig = buildDestinationConfig(env);

	await Promise.allSettled(
		batch.messages.map(async (message) => {
			try {
				const { fileKey, fileSize } = message.body;
				console.log(`[Queue] ${fileKey} is now being transferred (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
				const doId = env.MULTIPART_MIGRATOR.idFromName(fileKey);
				const stub = env.MULTIPART_MIGRATOR.get(doId);

				const job: MigrationJob = {
					fileKey,
					fileSize,
					sourceBucket: sourceConfig,
					destinationBucket: destConfig,
				};

				const response = await stub.fetch(new Request('https://do.internal/migrate', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(job),
				}));

				if (response.ok) {
					console.log(`[Queue] ${fileKey} migration started`);
					message.ack();
				} else {
					console.error(`DO rejected migration for ${fileKey}: ${response.status}`);
					message.retry();
				}
			} catch (error) {
				console.error(`Failed to dispatch migration for ${message.body.fileKey}: ${(error as Error).message}`);
				message.retry();
			}
		}),
	);
}
