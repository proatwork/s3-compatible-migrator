import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_FILE_RETRIES, THROTTLE_RETRY_DELAYS_MS } from '../../src/constants.ts';
import type { MigrationRow } from '../../src/dashboard/types';
import {
	completedText,
	durationText,
	EM_DASH,
	formatBytes,
	formatDuration,
	formatIsoTimestamp,
	formatLastRan,
	formatTimestamp,
	progressPercent,
	retryText,
	statusClass,
	statusLabel,
	throttleText,
	truncateKey,
} from '../../dashboard/src/format.ts';

const KIB = 1024;
const MAX_KEY_LENGTH = 60;
const NOW = 1_700_000_000;

function makeRow(overrides: Partial<MigrationRow> = {}): MigrationRow {
	return {
		key: 'file.bin',
		status: 'in_progress',
		file_size: 0,
		total_chunks: 0,
		chunks_done: 0,
		retry_count: 0,
		throttle_attempts: 0,
		next_retry_at: null,
		created_at: '1700000000',
		completed_at: null,
		skip_reason: null,
		...overrides,
	};
}

describe('EM_DASH', () => {
	it('is the em dash character', () => {
		assert.equal(EM_DASH, '—');
	});
});

describe('formatBytes', () => {
	it('returns 0 B for zero', () => {
		assert.equal(formatBytes(0), '0 B');
	});

	it('shows whole bytes without decimals', () => {
		assert.equal(formatBytes(1), '1 B');
		assert.equal(formatBytes(1023), '1023 B');
	});

	it('lands exactly on each unit boundary', () => {
		assert.equal(formatBytes(KIB), '1.0 KB');
		assert.equal(formatBytes(KIB ** 2), '1.0 MB');
		assert.equal(formatBytes(KIB ** 3), '1.0 GB');
		assert.equal(formatBytes(KIB ** 4), '1.0 TB');
	});

	it('keeps one decimal for scaled units', () => {
		assert.equal(formatBytes(1536), '1.5 KB');
	});

	it('clamps values above TB to the TB unit', () => {
		assert.equal(formatBytes(KIB ** 5), '1024.0 TB');
		assert.equal(formatBytes(KIB ** 6), '1048576.0 TB');
	});

	it('clamps values between 0 and 1 to the B unit', () => {
		assert.equal(formatBytes(0.25), '0 B');
		assert.equal(formatBytes(0.75), '1 B');
	});

	it('never produces an undefined unit for invalid input', () => {
		assert.equal(formatBytes(-1), '0 B');
		assert.equal(formatBytes(Number.NaN), '0 B');
	});
});

describe('truncateKey', () => {
	it('leaves short keys alone', () => {
		assert.equal(truncateKey(''), '');
		assert.equal(truncateKey('a/b.txt'), 'a/b.txt');
	});

	it('leaves a key of exactly the max length alone', () => {
		const key = 'x'.repeat(MAX_KEY_LENGTH);
		assert.equal(truncateKey(key), key);
	});

	it('keeps the tail of a key one over the max length', () => {
		const key = 'head-' + 'x'.repeat(MAX_KEY_LENGTH - 8) + 'end';
		assert.equal(key.length, MAX_KEY_LENGTH);
		const longKey = 'y' + key;
		const truncated = truncateKey(longKey);
		assert.equal(truncated.length, MAX_KEY_LENGTH);
		assert.ok(truncated.startsWith('...'));
		assert.ok(truncated.endsWith('xend'));
		assert.equal(truncated, '...' + longKey.slice(-57));
	});

	it('truncates very long keys to the max length', () => {
		const truncated = truncateKey('z'.repeat(5000) + 'tail');
		assert.equal(truncated.length, MAX_KEY_LENGTH);
		assert.ok(truncated.endsWith('tail'));
	});
});

describe('formatTimestamp', () => {
	it('returns the placeholder for zero and NaN', () => {
		assert.equal(formatTimestamp(0), EM_DASH);
		assert.equal(formatTimestamp(Number.NaN), EM_DASH);
	});

	it('formats as UTC without the T or milliseconds', () => {
		assert.equal(formatTimestamp(NOW), '2023-11-14 22:13:20');
	});
});

describe('formatDuration', () => {
	it('formats seconds only', () => {
		assert.equal(formatDuration(0), '0s');
		assert.equal(formatDuration(59), '59s');
	});

	it('formats minutes and seconds', () => {
		assert.equal(formatDuration(60), '1m 0s');
		assert.equal(formatDuration(3599), '59m 59s');
	});

	it('formats hours, minutes and seconds', () => {
		assert.equal(formatDuration(3600), '1h 0m 0s');
		assert.equal(formatDuration(3661), '1h 1m 1s');
	});

	it('does not roll hours over into days', () => {
		assert.equal(formatDuration(360_000), '100h 0m 0s');
	});

	it('returns the placeholder for negative and NaN durations', () => {
		assert.equal(formatDuration(-1), EM_DASH);
		assert.equal(formatDuration(Number.NaN), EM_DASH);
	});
});

describe('formatLastRan', () => {
	it('returns never when it has not run', () => {
		assert.equal(formatLastRan(0, NOW), 'never');
		assert.equal(formatLastRan(0), 'never');
	});

	it('uses seconds below one minute', () => {
		assert.equal(formatLastRan(NOW, NOW), '0s ago');
		assert.equal(formatLastRan(NOW - 59, NOW), '59s ago');
	});

	it('switches to minutes at one minute', () => {
		assert.equal(formatLastRan(NOW - 60, NOW), '1m ago');
		assert.equal(formatLastRan(NOW - 3599, NOW), '59m ago');
	});

	it('switches to hours and minutes at one hour', () => {
		assert.equal(formatLastRan(NOW - 3600, NOW), '1h 0m ago');
		assert.equal(formatLastRan(NOW - 3660, NOW), '1h 1m ago');
		assert.equal(formatLastRan(NOW - 90_000, NOW), '25h 0m ago');
	});

	it('defaults nowSeconds to the current time', () => {
		const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
		assert.match(formatLastRan(tenMinutesAgo), /^10m ago$/);
	});
});

describe('statusClass', () => {
	it('maps known statuses', () => {
		assert.equal(statusClass('completed'), 'completed');
		assert.equal(statusClass('failed'), 'failed');
		assert.equal(statusClass('in_progress'), 'in-progress');
		assert.equal(statusClass('queued'), 'queued');
		assert.equal(statusClass('throttled'), 'throttled');
		assert.equal(statusClass('skipped'), 'skipped');
	});

	it('treats unknown statuses as in progress', () => {
		assert.equal(statusClass('uploading'), 'in-progress');
	});
});

describe('statusLabel', () => {
	it('humanizes in_progress', () => {
		assert.equal(statusLabel('in_progress'), 'in progress');
	});

	it('passes other statuses through', () => {
		assert.equal(statusLabel('completed'), 'completed');
		assert.equal(statusLabel('failed'), 'failed');
		assert.equal(statusLabel('queued'), 'queued');
	});
});

describe('progressPercent', () => {
	it('rounds to a whole percent', () => {
		assert.equal(progressPercent(makeRow({ total_chunks: 3, chunks_done: 1 })), 33);
		assert.equal(progressPercent(makeRow({ total_chunks: 3, chunks_done: 2 })), 67);
	});

	it('covers the full range', () => {
		assert.equal(progressPercent(makeRow({ total_chunks: 4, chunks_done: 0 })), 0);
		assert.equal(progressPercent(makeRow({ total_chunks: 4, chunks_done: 4 })), 100);
	});

	it('treats zero total_chunks as done only when completed', () => {
		assert.equal(progressPercent(makeRow({ status: 'completed', total_chunks: 0 })), 100);
		assert.equal(progressPercent(makeRow({ status: 'in_progress', total_chunks: 0 })), 0);
		assert.equal(progressPercent(makeRow({ status: 'failed', total_chunks: 0 })), 0);
	});
});

describe('completedText', () => {
	it('returns the placeholder when completed_at is null', () => {
		assert.equal(completedText(makeRow({ completed_at: null })), EM_DASH);
	});

	it('formats the completion time', () => {
		assert.equal(completedText(makeRow({ completed_at: NOW })), '2023-11-14 22:13:20');
	});
});

describe('durationText', () => {
	it('returns the placeholder when completed_at is null', () => {
		assert.equal(durationText(makeRow({ completed_at: null })), EM_DASH);
	});

	it('handles a string created_at', () => {
		assert.equal(durationText(makeRow({ created_at: String(NOW - 61), completed_at: NOW })), '1m 1s');
	});

	it('handles a numeric created_at, which is what D1 actually returns', () => {
		const created_at = (NOW - 5) as unknown as string;
		assert.equal(durationText(makeRow({ created_at, completed_at: NOW })), '5s');
	});

	it('returns the placeholder when completed_at precedes created_at', () => {
		assert.equal(durationText(makeRow({ created_at: String(NOW + 1), completed_at: NOW })), EM_DASH);
	});

	it('returns the placeholder for a non-numeric created_at', () => {
		assert.equal(durationText(makeRow({ created_at: 'not-a-number', completed_at: NOW })), EM_DASH);
	});
});

describe('retryText', () => {
	it('shows the attempt against the configured max', () => {
		assert.equal(retryText(2), `retry 2/${MAX_FILE_RETRIES}`);
		assert.equal(retryText(0), `retry 0/${MAX_FILE_RETRIES}`);
	});
});

describe('formatIsoTimestamp', () => {
	it('formats an S3 LastModified value', () => {
		assert.equal(formatIsoTimestamp('2026-01-02T03:04:05.678Z'), '2026-01-02 03:04:05');
	});

	it('returns the placeholder for empty or unparseable input', () => {
		assert.equal(formatIsoTimestamp(''), EM_DASH);
		assert.equal(formatIsoTimestamp('not a date'), EM_DASH);
	});
});

describe('throttleText', () => {
	const throttled = (attempts: number, nextRetryAt: number | null) =>
		({ throttle_attempts: attempts, next_retry_at: nextRetryAt }) as MigrationRow;
	const max = THROTTLE_RETRY_DELAYS_MS.length;

	it('shows the retry number and time left', () => {
		assert.equal(throttleText(throttled(2, NOW + 30), NOW), `retry 2/${max} in 30s`);
		assert.equal(throttleText(throttled(max, NOW + 600), NOW), `retry ${max}/${max} in 10m 0s`);
	});

	it('never counts below zero', () => {
		assert.equal(throttleText(throttled(1, NOW - 10), NOW), `retry 1/${max} in 0s`);
	});

	it('omits the time when it is unknown', () => {
		assert.equal(throttleText(throttled(1, null), NOW), `retry 1/${max}`);
	});
});
