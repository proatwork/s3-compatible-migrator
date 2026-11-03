import { SOURCE_FILES_PAGE_SIZE, STATUS_COMPLETED, STATUS_FAILED, STATUS_IN_PROGRESS, STATUS_QUEUED, STATUS_SKIPPED, STATUS_THROTTLED } from '../constants';
import { buildSourceConfig } from '../lib/buildBucketConfigs';
import { s3ListObjects } from '../lib/s3Client';
import { getSettingStatement, parseCronEnabled, SETTING_CRON_ENABLED, SETTING_CRON_LAST_RAN, SETTING_DISCOVERY_COMPLETE } from '../lib/settings';
import type { DashboardData, MigrationRow, SourceFilesPage } from './types';

type SummaryRow = {
	total: number;
	completed: number;
	in_progress: number;
	queued: number;
	throttled: number;
	failed: number;
	skipped: number;
	total_bytes: number;
	completed_bytes: number;
};

export async function getMigrationData(db: D1Database): Promise<DashboardData> {
	const [allResult, summaryResult, cronEnabledResult, cronLastRanResult, discoveryCompleteResult] = await db.batch([
		db.prepare(
			`SELECT key, status, file_size, total_chunks, chunks_done, retry_count, throttle_attempts, next_retry_at, created_at, completed_at, skip_reason FROM migrations
			 ORDER BY CASE WHEN status = '${STATUS_FAILED}' THEN 0 WHEN status = '${STATUS_THROTTLED}' THEN 1 WHEN status = '${STATUS_IN_PROGRESS}' THEN 2 WHEN status = '${STATUS_QUEUED}' THEN 3 WHEN status = '${STATUS_SKIPPED}' THEN 4 ELSE 5 END, created_at DESC
			 LIMIT 300`,
		),
		db.prepare(
			`SELECT COUNT(*) as total,
				COALESCE(SUM(CASE WHEN status = '${STATUS_COMPLETED}' THEN 1 ELSE 0 END), 0) as completed,
				COALESCE(SUM(CASE WHEN status = '${STATUS_IN_PROGRESS}' THEN 1 ELSE 0 END), 0) as in_progress,
				COALESCE(SUM(CASE WHEN status = '${STATUS_QUEUED}' THEN 1 ELSE 0 END), 0) as queued,
				COALESCE(SUM(CASE WHEN status = '${STATUS_THROTTLED}' THEN 1 ELSE 0 END), 0) as throttled,
				COALESCE(SUM(CASE WHEN status = '${STATUS_FAILED}' THEN 1 ELSE 0 END), 0) as failed,
				COALESCE(SUM(CASE WHEN status = '${STATUS_SKIPPED}' THEN 1 ELSE 0 END), 0) as skipped,
				COALESCE(SUM(file_size), 0) as total_bytes,
				COALESCE(SUM(CASE WHEN status = '${STATUS_COMPLETED}' THEN file_size ELSE 0 END), 0) as completed_bytes
			FROM migrations`,
		),
		getSettingStatement(db, SETTING_CRON_ENABLED),
		getSettingStatement(db, SETTING_CRON_LAST_RAN),
		getSettingStatement(db, SETTING_DISCOVERY_COMPLETE),
	]);

	const migrations = allResult.results as unknown as MigrationRow[];

	const tableRows = migrations.filter(r => r.status !== STATUS_COMPLETED);

	const s = (summaryResult.results as unknown as SummaryRow[])[0];

	const summary = {
		total: s.total,
		completed: s.completed,
		inProgress: s.in_progress,
		queued: s.queued,
		throttled: s.throttled,
		failed: s.failed,
		skipped: s.skipped,
		totalBytes: s.total_bytes,
		completedBytes: s.completed_bytes,
	};

	const cronEnabledRow = cronEnabledResult.results[0] as { value: string } | undefined;
	const cronLastRanRow = cronLastRanResult.results[0] as { value: string } | undefined;
	const discoveryCompleteRow = discoveryCompleteResult.results[0] as { value: string } | undefined;
	const cronEnabled = parseCronEnabled(cronEnabledRow?.value);
	const cronLastRan = Number(cronLastRanRow?.value ?? '0');
	const discoveryComplete = discoveryCompleteRow?.value === 'true';

	return { migrations, tableRows, summary, cronEnabled, cronLastRan, discoveryComplete };
}

export async function getSourceFiles(env: Env, cursor?: string): Promise<SourceFilesPage> {
	const { objects, nextToken } = await s3ListObjects(buildSourceConfig(env), env.SOURCE_PREFIX, cursor, SOURCE_FILES_PAGE_SIZE);

	const statuses = new Map<string, string>();
	if (objects.length > 0) {
		const placeholders = objects.map(() => '?').join(',');
		const rows = await env.MIGRATION_DB.prepare(`SELECT key, status FROM migrations WHERE key IN (${placeholders})`)
			.bind(...objects.map(o => o.key))
			.all<{ key: string; status: string }>();
		for (const row of rows.results) {
			statuses.set(row.key, row.status);
		}
	}

	return {
		files: objects.map(o => ({
			key: o.key,
			size: o.size,
			lastModified: o.lastModified,
			status: statuses.get(o.key) ?? null,
		})),
		nextCursor: nextToken,
	};
}
