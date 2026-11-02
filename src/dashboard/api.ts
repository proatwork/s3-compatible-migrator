export type MigrationRow = {
	key: string;
	status: string;
	file_size: number;
	total_chunks: number;
	chunks_done: number;
	retry_count: number;
	created_at: string;
	completed_at: number | null;
};

type SummaryRow = {
	total: number;
	completed: number;
	in_progress: number;
	failed: number;
	total_bytes: number;
	completed_bytes: number;
};

export type DashboardData = {
	migrations: MigrationRow[];
	tableRows: MigrationRow[];
	summary: {
		total: number;
		completed: number;
		inProgress: number;
		failed: number;
		totalBytes: number;
		completedBytes: number;
	};
	cronEnabled: boolean;
	cronLastRan: number;
	discoveryComplete: boolean;
};

export async function getMigrationData(db: D1Database): Promise<DashboardData> {
	const [allResult, summaryResult, cronEnabledResult, cronLastRanResult, discoveryCompleteResult] = await db.batch([
		db.prepare(
			`SELECT key, status, file_size, total_chunks, chunks_done, retry_count, created_at, completed_at FROM migrations
			 ORDER BY CASE WHEN status = 'failed' THEN 0 WHEN status = 'in_progress' THEN 1 ELSE 2 END, created_at DESC
			 LIMIT 300`,
		),
		db.prepare(
			`SELECT COUNT(*) as total,
				SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
				SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
				COALESCE(SUM(file_size), 0) as total_bytes,
				COALESCE(SUM(CASE WHEN status = 'completed' THEN file_size ELSE 0 END), 0) as completed_bytes
			FROM migrations`,
		),
		db.prepare("SELECT value FROM settings WHERE key = 'cron_enabled'"),
		db.prepare("SELECT value FROM settings WHERE key = 'cron_last_ran'"),
		db.prepare("SELECT value FROM settings WHERE key = 'discovery_complete'"),
	]);

	const migrations = allResult.results as unknown as MigrationRow[];

	const tableRows = migrations.filter(r => r.status === 'failed' || r.status === 'in_progress');

	const s = (summaryResult.results as unknown as SummaryRow[])[0];

	const summary = {
		total: s.total,
		completed: s.completed,
		inProgress: s.in_progress,
		failed: s.failed,
		totalBytes: s.total_bytes,
		completedBytes: s.completed_bytes,
	};

	const cronEnabledRow = cronEnabledResult.results[0] as { value: string } | undefined;
	const cronLastRanRow = cronLastRanResult.results[0] as { value: string } | undefined;
	const discoveryCompleteRow = discoveryCompleteResult.results[0] as { value: string } | undefined;
	const cronEnabled = cronEnabledRow?.value !== 'false';
	const cronLastRan = Number(cronLastRanRow?.value ?? '0');
	const discoveryComplete = discoveryCompleteRow?.value === 'true';

	return { migrations, tableRows, summary, cronEnabled, cronLastRan, discoveryComplete };
}
