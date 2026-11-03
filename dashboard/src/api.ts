import { SETTING_CRON_ENABLED } from '../../src/constants';
import type { DashboardData, SourceFilesPage } from '../../src/dashboard/types';

const MIGRATIONS_PATH = '/api/migrations';
const SETTINGS_PATH = '/api/settings';
const RETRY_FAILED_PATH = '/api/retry-failed';
const ABORT_ALL_PATH = '/api/abort-all';
const ABORT_JOB_PATH = '/api/abort-job';
const SOURCE_FILES_PATH = '/api/source-files';
const START_PATH = '/api/start';
const PAUSE_PATH = '/api/pause';
const RESET_PATH = '/api/reset';

const METHOD_POST = 'POST';
const JSON_HEADERS = { 'content-type': 'application/json' };
// Only for polled and quick calls: a hung request would otherwise stall polling. Bulk actions may legitimately run longer.
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, init);
	if (!response.ok) {
		throw new Error(`${init?.method ?? 'GET'} ${path} failed with status ${response.status}`);
	}
	return (await response.json()) as T;
}

function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
	return request<T>(path, { method: METHOD_POST, headers: JSON_HEADERS, body: JSON.stringify(body), signal });
}

export function fetchDashboard(): Promise<DashboardData> {
	return request<DashboardData>(MIGRATIONS_PATH, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export async function setCronEnabled(enabled: boolean): Promise<void> {
	await postJson<unknown>(
		SETTINGS_PATH,
		{ key: SETTING_CRON_ENABLED, value: enabled ? 'true' : 'false' },
		AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	);
}

export function retryFailed(): Promise<{ retried: number }> {
	return request<{ retried: number }>(RETRY_FAILED_PATH, { method: METHOD_POST });
}

export function abortAll(): Promise<{ aborted: number; unreachable: number }> {
	return request<{ aborted: number; unreachable: number }>(ABORT_ALL_PATH, { method: METHOD_POST });
}

export function abortJob(key: string): Promise<{ aborted: boolean; key: string }> {
	return postJson<{ aborted: boolean; key: string }>(ABORT_JOB_PATH, { key });
}

export async function startProcessing(): Promise<void> {
	await request<unknown>(START_PATH, { method: METHOD_POST, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export async function pauseProcessing(): Promise<void> {
	await request<unknown>(PAUSE_PATH, { method: METHOD_POST, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export function resetTransfers(): Promise<{ reset: number }> {
	return request<{ reset: number }>(RESET_PATH, { method: METHOD_POST });
}

export function fetchSourceFiles(cursor: string | null): Promise<SourceFilesPage> {
	const query = cursor ? `?${new URLSearchParams({ cursor })}` : '';
	return request<SourceFilesPage>(`${SOURCE_FILES_PATH}${query}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}
