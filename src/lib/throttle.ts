import { THROTTLE_RETRY_DELAYS_MS } from '../constants.ts';

const THROTTLED_STATUSES = new Set([429, 503]);
const THROTTLED_CODE_PATTERN = /<Code>\s*(?:SlowDown|TooManyRequests)\s*<\/Code>/i;
export const MAX_JITTER_RATIO = 0.2;

export class S3ThrottledError extends Error {}

export function isThrottledResponse(status: number, body: string = ''): boolean {
	return THROTTLED_STATUSES.has(status) || THROTTLED_CODE_PATTERN.test(body);
}

// Returns null once the schedule is used up. The jitter stops files throttled together from all retrying together.
export function throttleDelayMs(attempt: number, random: () => number = Math.random): number | null {
	const delay = THROTTLE_RETRY_DELAYS_MS[attempt];
	if (delay === undefined) return null;
	return Math.round(delay * (1 + random() * MAX_JITTER_RATIO));
}
