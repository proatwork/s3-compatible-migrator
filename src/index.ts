import { getMigrationData } from './dashboard/api';
import { renderDashboard } from './dashboard/template';
import { handleScheduled } from './handlers/cronHandler';
import { handleQueue } from './handlers/queueHandler';
import { retryFailedJobs } from './lib/retryFailedJobs';
import { setSetting } from './lib/settings';
import type { QueueMessage } from './types';

export { MultipartMigratorV4 } from './durable-objects/multipartMigrator';

export default {
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.warn(`⏲️ Cron triggered`);
		await handleScheduled(env);
	},

	async queue(batch: MessageBatch<QueueMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
		await handleQueue(batch, env);
	},

	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return new Response('ok');
		}

		if (url.pathname === '/trigger') {
			ctx.waitUntil(handleScheduled(env));
			return new Response('Migration scan triggered');
		}

		if (url.pathname === '/reset-all') {
			const rows = await env.MIGRATION_DB.prepare(
				'SELECT key FROM migrations',
			).all<{ key: string }>();

			const BATCH_SIZE = 20;
			let resetCount = 0;
			for (let i = 0; i < rows.results.length; i += BATCH_SIZE) {
				const batch = rows.results.slice(i, i + BATCH_SIZE);
				const results = await Promise.allSettled(
					batch.map(row => {
						const doId = env.MULTIPART_MIGRATOR.idFromName(row.key);
						const stub = env.MULTIPART_MIGRATOR.get(doId);
						return stub.fetch(new Request('https://do.internal/reset', { method: 'DELETE' }));
					}),
				);
				resetCount += results.filter(r => r.status === 'fulfilled').length;
			}

			await env.MIGRATION_DB.prepare('DELETE FROM migrations').run();

			return new Response(`Reset ${resetCount} DOs and cleared D1 registry`);
		}

		if (url.pathname === '/' || url.pathname === '/dashboard') {
			const data = await getMigrationData(env.MIGRATION_DB);
			return new Response(renderDashboard(data), {
				headers: { 'content-type': 'text/html; charset=utf-8' },
			});
		}

		if (url.pathname === '/api/settings' && request.method === 'POST') {
			const body = await request.json() as { key: string; value: string };
			await setSetting(env.MIGRATION_DB, body.key, body.value);
			return new Response(JSON.stringify({ key: body.key, value: body.value }), {
				headers: { 'content-type': 'application/json' },
			});
		}

		if (url.pathname === '/api/settings' && request.method === 'GET') {
			const rows = await env.MIGRATION_DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
			const settings: Record<string, string> = {};
			for (const row of rows.results) {
				settings[row.key] = row.value;
			}
			return new Response(JSON.stringify(settings), {
				headers: { 'content-type': 'application/json' },
			});
		}

		if (url.pathname === '/api/failed') {
			const rows = await env.MIGRATION_DB.prepare(
				'SELECT key, status, file_size, total_chunks, chunks_done, retry_count, created_at, completed_at, failed_at FROM migrations WHERE status = ? ORDER BY failed_at DESC',
			).bind('failed').all();
			return new Response(JSON.stringify(rows.results), {
				headers: { 'content-type': 'application/json' },
			});
		}

		if (url.pathname === '/api/abort-job' && request.method === 'POST') {
			const { key } = await request.json() as { key: string };
			const doId = env.MULTIPART_MIGRATOR.idFromName(key);
			const stub = env.MULTIPART_MIGRATOR.get(doId);
			const doResp = await stub.fetch(new Request('https://do.internal/abort', { method: 'POST' }));

			if (doResp.ok) {
				await env.MIGRATION_DB.prepare(
					'UPDATE migrations SET status = ?, failed_at = ? WHERE key = ?',
				).bind('failed', Math.floor(Date.now() / 1000), key).run();
			}

			return new Response(JSON.stringify({ aborted: doResp.ok, key }), {
				headers: { 'content-type': 'application/json' },
			});
		}

		if (url.pathname === '/api/abort-all' && request.method === 'POST') {
			const rows = await env.MIGRATION_DB.prepare(
				'SELECT key FROM migrations WHERE status = ?',
			).bind('in_progress').all<{ key: string }>();

			let aborted = 0;
			const BATCH_SIZE = 20;
			for (let i = 0; i < rows.results.length; i += BATCH_SIZE) {
				const batch = rows.results.slice(i, i + BATCH_SIZE);
				const results = await Promise.allSettled(
					batch.map(row => {
						const doId = env.MULTIPART_MIGRATOR.idFromName(row.key);
						const stub = env.MULTIPART_MIGRATOR.get(doId);
						return stub.fetch(new Request('https://do.internal/abort', { method: 'POST' }));
					}),
				);
				aborted += results.filter(r => r.status === 'fulfilled' && (r.value as Response).ok).length;
			}

			await env.MIGRATION_DB.prepare(
				'UPDATE migrations SET status = ?, failed_at = ? WHERE status = ?',
			).bind('failed', Math.floor(Date.now() / 1000), 'in_progress').run();

			return new Response(JSON.stringify({ aborted }), {
				headers: { 'content-type': 'application/json' },
			});
		}

		if (url.pathname === '/api/retry-failed' && request.method === 'POST') {
			const count = await retryFailedJobs(env);
			return new Response(JSON.stringify({ retried: count }), {
				headers: { 'content-type': 'application/json' },
			});
		}

		if (url.pathname === '/api/migrations') {
			const data = await getMigrationData(env.MIGRATION_DB);
			return new Response(JSON.stringify(data), {
				headers: { 'content-type': 'application/json' },
			});
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env, QueueMessage>;
