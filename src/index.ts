import { HTTP_NOT_FOUND, MAX_FILE_RETRIES, STATUS_COMPLETED, STATUS_IN_PROGRESS, STATUS_THROTTLED } from './constants';
import { getMigrationData, getSourceFiles } from './dashboard/api';
import { handleScheduled } from './handlers/cronHandler';
import { handleQueue } from './handlers/queueHandler';
import { abortMigrators } from './lib/durableObjects';
import { markFailedStatement } from './lib/migrationRows';
import { resetTransfers } from './lib/resetTransfers';
import { retryFailedJobs } from './lib/retryFailedJobs';
import { resetDiscovery, setSetting, SETTING_CRON_ENABLED } from './lib/settings';
import type { QueueMessage } from './types';

export { FileMigrator } from './durable-objects/fileMigrator';

const JSON_HEADERS = { 'content-type': 'application/json' };
const HTTP_BAD_GATEWAY = 502;

function jsonResponse(body: unknown, status?: number): Response {
	return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default {
	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		console.log('[Cron] Triggered');
		await handleScheduled(env);
	},

	async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
		await handleQueue(batch, env);
	},

	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return new Response('ok');
		}

		if (url.pathname === '/api/settings' && request.method === 'POST') {
			const body = await request.json() as { key: string; value: string };
			await setSetting(env.MIGRATION_DB, body.key, body.value);
			return jsonResponse({ key: body.key, value: body.value });
		}

		if (url.pathname === '/api/settings' && request.method === 'GET') {
			const rows = await env.MIGRATION_DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
			const settings: Record<string, string> = {};
			for (const row of rows.results) {
				settings[row.key] = row.value;
			}
			return jsonResponse(settings);
		}

		if (url.pathname === '/api/abort-job' && request.method === 'POST') {
			const { key } = await request.json() as { key: string };
			// No job in the Durable Object also counts, since nothing is running for that row.
			const aborted = (await abortMigrators(env, [key])).failed.length === 0;

			if (aborted) {
				await markFailedStatement(env.MIGRATION_DB, 'key = ? AND status != ?', MAX_FILE_RETRIES, key, STATUS_COMPLETED).run();
			}

			return jsonResponse({ aborted, key });
		}

		if (url.pathname === '/api/abort-all' && request.method === 'POST') {
			const rows = await env.MIGRATION_DB.prepare(
				'SELECT key FROM migrations WHERE status IN (?, ?)',
			).bind(STATUS_IN_PROGRESS, STATUS_THROTTLED).all<{ key: string }>();

			const result = await abortMigrators(env, rows.results.map(row => row.key));

			// A job that couldn't be reached may still be copying, so its row keeps counting toward the concurrency limit.
			const stopped = [...result.succeeded, ...result.notFound];
			if (stopped.length > 0) {
				await env.MIGRATION_DB.batch(stopped.map(key =>
					markFailedStatement(env.MIGRATION_DB, 'key = ? AND status IN (?, ?)', MAX_FILE_RETRIES, key, STATUS_IN_PROGRESS, STATUS_THROTTLED),
				));
			}
			if (result.failed.length > 0) console.warn(`[AbortAll] Could not reach ${result.failed.length} jobs, leaving them running`);

			return jsonResponse({ aborted: stopped.length, unreachable: result.failed.length });
		}

		if (url.pathname === '/api/retry-failed' && request.method === 'POST') {
			const count = await retryFailedJobs(env);
			ctx.waitUntil(handleScheduled(env));
			return jsonResponse({ retried: count });
		}

		if (url.pathname === '/api/start' && request.method === 'POST') {
			await setSetting(env.MIGRATION_DB, SETTING_CRON_ENABLED, 'true');
			await resetDiscovery(env.MIGRATION_DB);
			ctx.waitUntil(retryFailedJobs(env).then(() => handleScheduled(env)));
			return jsonResponse({ started: true });
		}

		if (url.pathname === '/api/pause' && request.method === 'POST') {
			await setSetting(env.MIGRATION_DB, SETTING_CRON_ENABLED, 'false');
			return jsonResponse({ paused: true });
		}

		if (url.pathname === '/api/reset' && request.method === 'POST') {
			const reset = await resetTransfers(env);
			return jsonResponse({ reset });
		}

		if (url.pathname === '/api/source-files') {
			try {
				const page = await getSourceFiles(env, url.searchParams.get('cursor') ?? undefined);
				return jsonResponse(page);
			} catch (err) {
				console.error('[Dashboard] Failed to list source files:', err);
				return jsonResponse({ error: 'Failed to list source files' }, HTTP_BAD_GATEWAY);
			}
		}

		if (url.pathname === '/api/migrations') {
			return jsonResponse(await getMigrationData(env.MIGRATION_DB));
		}

		return new Response('Not found', { status: HTTP_NOT_FOUND });
	},
} satisfies ExportedHandler<Env, QueueMessage>;
