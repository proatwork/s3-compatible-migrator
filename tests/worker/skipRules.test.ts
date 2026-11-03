import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_COPYABLE_FILE_BYTES } from '../../src/constants.ts';
import { hasDotSegment, skipReason } from '../../src/lib/skipRules.ts';

describe('hasDotSegment', () => {
	it('finds dot segments anywhere in the key', () => {
		for (const key of ['..', '.', 'a/../b', './a', 'a/..', 'a/./b', '../other-bucket/x']) {
			assert.equal(hasDotSegment(key), true, key);
		}
	});

	it('allows dots that are part of a name', () => {
		for (const key of ['..a', 'a..', '.hidden', 'a/.b/c', 'file.tar.gz', 'a//b', '/a', '...']) {
			assert.equal(hasDotSegment(key), false, key);
		}
	});
});

describe('skipReason', () => {
	it('copies ordinary files', () => {
		assert.equal(skipReason('photos/a.jpg', 1024), null);
		assert.equal(skipReason('empty', 0), null);
		assert.equal(skipReason('..a', 1), null);
	});

	it('skips keys with dot segments', () => {
		assert.match(skipReason('a/../b', 1) ?? '', /path segment/);
	});

	it('reports the key problem first when both rules apply', () => {
		assert.match(skipReason('a/../b', MAX_COPYABLE_FILE_BYTES + 1) ?? '', /path segment/);
	});

	it('copies a file exactly at the size limit and skips one byte over', () => {
		assert.equal(skipReason('big', MAX_COPYABLE_FILE_BYTES), null);
		assert.match(skipReason('big', MAX_COPYABLE_FILE_BYTES + 1) ?? '', /larger/);
	});
});
