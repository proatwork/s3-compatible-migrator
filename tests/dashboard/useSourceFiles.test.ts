import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SourceFilesPage } from '../../src/dashboard/types';
import { useSourceFiles } from '../../dashboard/src/useSourceFiles.ts';

function page(name: string, nextCursor: string | null): SourceFilesPage {
	return { files: [{ key: name, size: 1, lastModified: '', status: null }], nextCursor };
}

const PAGES: Record<string, SourceFilesPage> = {
	first: page('one', 'cursor-2'),
	'cursor-2': page('two', 'cursor-3'),
	'cursor-3': page('three', null),
};

function fakeFetch() {
	const calls: (string | null)[] = [];
	const fetchPage = async (cursor: string | null) => {
		calls.push(cursor);
		return PAGES[cursor ?? 'first'];
	};
	return { calls, fetchPage };
}

describe('useSourceFiles', () => {
	it('loads the first page without a cursor', async () => {
		const { calls, fetchPage } = fakeFetch();
		const pager = useSourceFiles(fetchPage);
		await pager.reload();
		assert.deepEqual(calls, [null]);
		assert.equal(pager.files.value[0].key, 'one');
		assert.equal(pager.pageNumber.value, 1);
		assert.equal(pager.hasPrevious.value, false);
		assert.equal(pager.hasNext.value, true);
	});

	it('walks forward to the last page and stops', async () => {
		const { calls, fetchPage } = fakeFetch();
		const pager = useSourceFiles(fetchPage);
		await pager.reload();
		await pager.next();
		await pager.next();
		assert.equal(pager.files.value[0].key, 'three');
		assert.equal(pager.pageNumber.value, 3);
		assert.equal(pager.hasNext.value, false);
		await pager.next();
		assert.equal(pager.pageNumber.value, 3);
		assert.deepEqual(calls, [null, 'cursor-2', 'cursor-3']);
	});

	it('goes back by replaying the earlier cursor', async () => {
		const { calls, fetchPage } = fakeFetch();
		const pager = useSourceFiles(fetchPage);
		await pager.reload();
		await pager.next();
		await pager.next();
		await pager.previous();
		assert.equal(pager.files.value[0].key, 'two');
		assert.equal(pager.pageNumber.value, 2);
		assert.equal(pager.hasNext.value, true);
		await pager.previous();
		assert.equal(pager.files.value[0].key, 'one');
		assert.equal(calls.at(-1), null);
		await pager.previous();
		assert.equal(pager.pageNumber.value, 1);
	});

	it('ignores navigation while a page is loading', async () => {
		let release: () => void = () => {};
		const calls: (string | null)[] = [];
		const pager = useSourceFiles(async (cursor) => {
			calls.push(cursor);
			if (cursor === 'cursor-2') await new Promise<void>((resolve) => (release = resolve));
			return PAGES[cursor ?? 'first'];
		});
		await pager.reload();
		const pending = pager.next();
		assert.equal(pager.loading.value, true);
		await pager.next();
		await pager.previous();
		await pager.reload();
		release();
		await pending;
		assert.deepEqual(calls, [null, 'cursor-2']);
		assert.equal(pager.pageNumber.value, 2);
		assert.equal(pager.loading.value, false);
	});

	it('reports a failure, clears the page, and recovers on reload', async () => {
		let shouldFail = false;
		const pager = useSourceFiles(async (cursor) => {
			if (shouldFail) throw new Error('listing failed');
			return PAGES[cursor ?? 'first'];
		});
		await pager.reload();
		shouldFail = true;
		await pager.next();
		assert.equal(pager.failed.value, true);
		assert.equal(pager.files.value.length, 0);
		assert.equal(pager.hasNext.value, false);
		assert.equal(pager.hasPrevious.value, true);
		assert.equal(pager.loading.value, false);
		shouldFail = false;
		await pager.reload();
		assert.equal(pager.failed.value, false);
		assert.equal(pager.files.value[0].key, 'two');
		assert.equal(pager.pageNumber.value, 2);
	});
});
