import { MAX_COPYABLE_FILE_BYTES } from '../constants.ts';

const DOT_SEGMENTS = new Set(['.', '..']);

// URLs collapse these segments, so the request would reach a different key, or a different bucket.
export function hasDotSegment(key: string): boolean {
	return key.split('/').some(segment => DOT_SEGMENTS.has(segment));
}

export function skipReason(key: string, size: number): string | null {
	if (hasDotSegment(key)) return 'Key contains a "." or ".." path segment';
	if (size > MAX_COPYABLE_FILE_BYTES) return 'File is larger than a multipart upload can hold';
	return null;
}
