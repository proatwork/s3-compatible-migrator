export type MigrationRow = {
	key: string;
	status: string;
	file_size: number;
	total_chunks: number;
	chunks_done: number;
	retry_count: number;
	throttle_attempts: number;
	next_retry_at: number | null;
	created_at: string;
	completed_at: number | null;
	skip_reason: string | null;
};

export type DashboardData = {
	migrations: MigrationRow[];
	tableRows: MigrationRow[];
	summary: {
		total: number;
		completed: number;
		inProgress: number;
		queued: number;
		throttled: number;
		failed: number;
		skipped: number;
		totalBytes: number;
		completedBytes: number;
	};
	cronEnabled: boolean;
	cronLastRan: number;
	discoveryComplete: boolean;
};

export type SourceFile = {
	key: string;
	size: number;
	lastModified: string;
	status: string | null;
};

export type SourceFilesPage = {
	files: SourceFile[];
	nextCursor: string | null;
};
