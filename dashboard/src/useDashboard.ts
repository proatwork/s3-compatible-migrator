import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { DashboardData } from '../../src/dashboard/types';
import { fetchDashboard, setCronEnabled as postCronEnabled } from './api';

export const POLL_INTERVAL_MS = 2500;
const REFRESH_INDICATOR_LINGER_MS = 1000;

export function useDashboard(): {
	data: Readonly<ShallowRef<DashboardData | null>>;
	refreshing: Readonly<Ref<boolean>>;
	connectionLost: Readonly<Ref<boolean>>;
	refresh: () => Promise<void>;
	setCronEnabled: (enabled: boolean) => Promise<void>;
} {
	const data = shallowRef<DashboardData | null>(null);
	const refreshing = ref(false);
	const connectionLost = ref(false);

	let stopped = false;
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	let refreshingTimer: ReturnType<typeof setTimeout> | undefined;
	let inFlight: Promise<void> | null = null;

	// Bumped when a cron toggle starts and again when it settles, so a cron value whose read may predate the write is never applied.
	let toggleCounter = 0;
	let togglesPending = 0;
	let confirmedCronEnabled: boolean | undefined;

	async function fetchOnce(): Promise<void> {
		const startedAt = toggleCounter;
		clearTimeout(pollTimer);
		clearTimeout(refreshingTimer);
		refreshing.value = true;

		try {
			const next = await fetchDashboard();
			if (stopped) return;
			connectionLost.value = false;
			const cronIsCurrent = startedAt === toggleCounter && togglesPending === 0;
			if (cronIsCurrent) confirmedCronEnabled = next.cronEnabled;
			data.value = cronIsCurrent || !data.value ? next : { ...next, cronEnabled: data.value.cronEnabled };
		} catch {
			if (!stopped) connectionLost.value = true;
		} finally {
			if (!stopped) {
				refreshingTimer = setTimeout(() => {
					refreshing.value = false;
				}, REFRESH_INDICATOR_LINGER_MS);
				pollTimer = setTimeout(() => void refresh(), POLL_INTERVAL_MS);
			}
		}
	}

	// Always reads fresh: a caller arriving mid-poll waits it out rather than overlapping it or reusing a stale read.
	async function refresh(): Promise<void> {
		while (inFlight) await inFlight;
		if (stopped) return;
		inFlight = fetchOnce().finally(() => {
			inFlight = null;
		});
		await inFlight;
	}

	function applyCronEnabled(enabled: boolean): void {
		if (data.value) data.value = { ...data.value, cronEnabled: enabled };
	}

	async function setCronEnabled(enabled: boolean): Promise<void> {
		toggleCounter++;
		togglesPending++;
		applyCronEnabled(enabled);

		let failed = false;
		try {
			await postCronEnabled(enabled);
			confirmedCronEnabled = enabled;
		} catch {
			failed = true;
		}

		toggleCounter++;
		togglesPending--;

		if (failed) {
			// Revert first: the POST likely failed because the network did, in which case the re-fetch will fail too.
			if (togglesPending === 0 && confirmedCronEnabled !== undefined) applyCronEnabled(confirmedCronEnabled);
			await refresh();
		}
	}

	onMounted(() => {
		void refresh();
	});

	onUnmounted(() => {
		stopped = true;
		clearTimeout(pollTimer);
		clearTimeout(refreshingTimer);
	});

	return { data, refreshing, connectionLost, refresh, setCronEnabled };
}
