import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCronEnabled } from '../../src/lib/settings.ts';

describe('parseCronEnabled', () => {
	it('is running only when explicitly enabled', () => {
		assert.equal(parseCronEnabled('true'), true);
	});

	it('treats anything else, including a missing setting, as paused', () => {
		for (const value of ['false', null, undefined, '', '1', 'TRUE']) {
			assert.equal(parseCronEnabled(value), false, String(value));
		}
	});
});
