import { computed, ref, shallowRef } from 'vue';
import type { SourceFile, SourceFilesPage } from '../../src/dashboard/types';

type FetchPage = (cursor: string | null) => Promise<SourceFilesPage>;

// S3 listings only page forward through continuation tokens, so going back replays the cursor of an earlier page.
export function useSourceFiles(fetchPage: FetchPage) {
	const files = shallowRef<SourceFile[]>([]);
	const loading = ref(false);
	const failed = ref(false);
	const cursors = ref<(string | null)[]>([null]);
	const nextCursor = ref<string | null>(null);

	const pageNumber = computed(() => cursors.value.length);
	const hasPrevious = computed(() => cursors.value.length > 1);
	const hasNext = computed(() => nextCursor.value !== null);

	async function load(): Promise<void> {
		loading.value = true;
		failed.value = false;
		try {
			const page = await fetchPage(cursors.value[cursors.value.length - 1]);
			files.value = page.files;
			nextCursor.value = page.nextCursor;
		} catch {
			files.value = [];
			nextCursor.value = null;
			failed.value = true;
		} finally {
			loading.value = false;
		}
	}

	async function reload(): Promise<void> {
		if (!loading.value) await load();
	}

	async function next(): Promise<void> {
		if (loading.value || nextCursor.value === null) return;
		cursors.value = [...cursors.value, nextCursor.value];
		await load();
	}

	async function previous(): Promise<void> {
		if (loading.value || !hasPrevious.value) return;
		cursors.value = cursors.value.slice(0, -1);
		await load();
	}

	return { files, loading, failed, pageNumber, hasPrevious, hasNext, reload, next, previous };
}
