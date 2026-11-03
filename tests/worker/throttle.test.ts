import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { THROTTLE_RETRY_DELAYS_MS } from '../../src/constants.ts';
import { isThrottledResponse, MAX_JITTER_RATIO, throttleDelayMs } from '../../src/lib/throttle.ts';

describe('isThrottledResponse', () => {
	it('detects throttling status codes without a body', () => {
		assert.equal(isThrottledResponse(429), true);
		assert.equal(isThrottledResponse(503), true);
	});

	it('detects throttling error codes under any status', () => {
		assert.equal(isThrottledResponse(400, '<Error><Code>SlowDown</Code></Error>'), true);
		assert.equal(isThrottledResponse(200, '<Error><Code>TooManyRequests</Code></Error>'), true);
	});

	it('ignores other failures', () => {
		assert.equal(isThrottledResponse(403, '<Error><Code>AccessDenied</Code></Error>'), false);
		assert.equal(isThrottledResponse(500), false);
		assert.equal(isThrottledResponse(404), false);
	});

	it('is not fooled by a key that contains the word', () => {
		assert.equal(isThrottledResponse(404, '<Error><Code>NoSuchKey</Code><Key>SlowDown.mp4</Key></Error>'), false);
	});
});

describe('throttleDelayMs', () => {
	it('has an increasing schedule', () => {
		assert.ok(THROTTLE_RETRY_DELAYS_MS.length > 0);
		THROTTLE_RETRY_DELAYS_MS.slice(1).forEach((delay, i) => assert.ok(delay > THROTTLE_RETRY_DELAYS_MS[i]));
	});

	it('follows the schedule, then gives up', () => {
		const delays = THROTTLE_RETRY_DELAYS_MS.map((_, attempt) => throttleDelayMs(attempt, () => 0));
		assert.deepEqual(delays, [...THROTTLE_RETRY_DELAYS_MS]);
		assert.equal(throttleDelayMs(THROTTLE_RETRY_DELAYS_MS.length), null);
	});

	it('only ever adds up to MAX_JITTER_RATIO jitter', () => {
		THROTTLE_RETRY_DELAYS_MS.forEach((base, attempt) => {
			assert.equal(throttleDelayMs(attempt, () => 0), base);
			assert.equal(throttleDelayMs(attempt, () => 0.999999), Math.round(base * (1 + MAX_JITTER_RATIO)));
		});
	});
});
