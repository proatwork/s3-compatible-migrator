import {
	MAX_FILE_RETRIES,
	MS_PER_SECOND,
	STATUS_COMPLETED,
	STATUS_FAILED,
	STATUS_IN_PROGRESS,
	STATUS_QUEUED,
	STATUS_SKIPPED,
	STATUS_THROTTLED,
	THROTTLE_RETRY_DELAYS_MS,
} from '../../src/constants.ts';
import type { MigrationRow } from '../../src/dashboard/types';

export const EM_DASH = '—';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const BYTES_PER_UNIT = 1024;
const ZERO_BYTES = '0 B';
const SCALED_UNIT_DECIMALS = 1;

const MAX_KEY_LENGTH = 60;
const TRUNCATION_PREFIX = '...';

export { MS_PER_SECOND };
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const ISO_DATETIME_LENGTH = 'YYYY-MM-DD HH:MM:SS'.length;

const PERCENT_COMPLETE = 100;

export function formatBytes(bytes: number): string {
	if (!(bytes > 0)) return ZERO_BYTES;
	const exponent = Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT));
	const i = Math.min(Math.max(exponent, 0), BYTE_UNITS.length - 1);
	return (bytes / Math.pow(BYTES_PER_UNIT, i)).toFixed(i > 0 ? SCALED_UNIT_DECIMALS : 0) + ' ' + BYTE_UNITS[i];
}

export function truncateKey(key: string): string {
	return key.length > MAX_KEY_LENGTH ? TRUNCATION_PREFIX + key.slice(-(MAX_KEY_LENGTH - TRUNCATION_PREFIX.length)) : key;
}

export function formatTimestamp(epochSeconds: number): string {
	if (!epochSeconds) return EM_DASH;
	return new Date(epochSeconds * MS_PER_SECOND).toISOString().replace('T', ' ').slice(0, ISO_DATETIME_LENGTH);
}

export function formatDuration(seconds: number): string {
	if (!(seconds >= 0)) return EM_DASH;
	const h = Math.floor(seconds / SECONDS_PER_HOUR);
	const m = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
	const s = seconds % SECONDS_PER_MINUTE;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

export function formatLastRan(epochSeconds: number, nowSeconds: number = Math.floor(Date.now() / MS_PER_SECOND)): string {
	if (!epochSeconds) return 'never';
	const seconds = nowSeconds - epochSeconds;
	if (seconds < SECONDS_PER_MINUTE) return `${seconds}s ago`;
	const m = Math.floor(seconds / SECONDS_PER_MINUTE);
	if (m < MINUTES_PER_HOUR) return `${m}m ago`;
	const h = Math.floor(m / MINUTES_PER_HOUR);
	return `${h}h ${m % MINUTES_PER_HOUR}m ago`;
}

export function statusClass(status: string): 'completed' | 'failed' | 'queued' | 'throttled' | 'skipped' | 'in-progress' {
	if (status === STATUS_COMPLETED) return 'completed';
	if (status === STATUS_FAILED) return 'failed';
	if (status === STATUS_QUEUED) return 'queued';
	if (status === STATUS_THROTTLED) return 'throttled';
	if (status === STATUS_SKIPPED) return 'skipped';
	return 'in-progress';
}

export function statusLabel(status: string): string {
	return status === STATUS_IN_PROGRESS ? 'in progress' : status;
}

export function progressPercent(row: MigrationRow): number {
	if (row.total_chunks > 0) return Math.round((row.chunks_done / row.total_chunks) * PERCENT_COMPLETE);
	return row.status === STATUS_COMPLETED ? PERCENT_COMPLETE : 0;
}

export function completedText(row: MigrationRow): string {
	return row.completed_at ? formatTimestamp(Number(row.completed_at)) : EM_DASH;
}

export function durationText(row: MigrationRow): string {
	return row.completed_at ? formatDuration(Number(row.completed_at) - Number(row.created_at)) : EM_DASH;
}

export function retryText(retryCount: number): string {
	return `retry ${retryCount}/${MAX_FILE_RETRIES}`;
}

export function formatIsoTimestamp(iso: string): string {
	const milliseconds = Date.parse(iso);
	return Number.isNaN(milliseconds) ? EM_DASH : formatTimestamp(Math.floor(milliseconds / MS_PER_SECOND));
}

export function throttleText(row: MigrationRow, nowSeconds: number = Math.floor(Date.now() / MS_PER_SECOND)): string {
	const retry = `retry ${row.throttle_attempts}/${THROTTLE_RETRY_DELAYS_MS.length}`;
	if (row.next_retry_at === null) return retry;
	return `${retry} in ${formatDuration(Math.max(0, row.next_retry_at - nowSeconds))}`;
}
