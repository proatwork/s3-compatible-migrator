<script setup lang="ts">
import { pauseProcessing, resetTransfers, startProcessing } from '../api';
import { formatLastRan, MS_PER_SECOND } from '../format';
import { POLL_INTERVAL_MS } from '../useDashboard';
import ActionButton from './ActionButton.vue';

defineProps<{
	cronEnabled: boolean;
	cronLastRan: number;
	discoveryComplete: boolean;
	inProgress: number;
	refreshing: boolean;
}>();

const POLL_SECONDS = POLL_INTERVAL_MS / MS_PER_SECOND;

const emit = defineEmits<{
	'toggle-cron': [enabled: boolean];
	done: [];
}>();

async function start(): Promise<string> {
	await startProcessing();
	return 'Started';
}

async function pause(): Promise<string> {
	await pauseProcessing();
	return 'Paused';
}

async function reset(): Promise<string> {
	const { reset: count } = await resetTransfers();
	return `Reset ${count} transfers`;
}

function onToggleChange(event: Event) {
	emit('toggle-cron', (event.target as HTMLInputElement).checked);
}
</script>

<template>
	<div class="header">
		<div class="header-left">
			<h1>Migration Dashboard</h1>
			<span class="cron-last-ran">Cron last ran {{ formatLastRan(cronLastRan) }}</span>
			<span v-if="!cronEnabled" class="discovery-status paused">
				Paused<template v-if="inProgress > 0">, {{ inProgress }} finishing</template>
			</span>
			<span v-else class="discovery-status" :class="discoveryComplete ? 'complete' : 'scanning'">
				{{ discoveryComplete ? 'Discovery complete' : 'Scanning source' }}
			</span>
		</div>
		<div class="header-right">
			<div class="processing-controls">
				<ActionButton class="start-btn" idle-label="Start" pending-label="Starting..." :action="start" @done="emit('done')" />
				<ActionButton class="pause-btn" idle-label="Pause" pending-label="Pausing..." :action="pause" :disabled="!cronEnabled" @done="emit('done')" />
				<ActionButton
					class="reset-btn"
					idle-label="Reset transfers"
					confirm-label="Confirm reset?"
					pending-label="Resetting..."
					:action="reset"
					@done="emit('done')"
				/>
			</div>
			<div class="cron-toggle">
				<label class="toggle-switch">
					<input id="cron-toggle" type="checkbox" :checked="cronEnabled" @change="onToggleChange" />
					<span class="toggle-slider"></span>
				</label>
				<label for="cron-toggle">Keep destination in sync</label>
			</div>
			<div class="refresh-indicator">
				<div class="refresh-dot" :class="{ active: refreshing }"></div>
				Auto-refreshing every {{ POLL_SECONDS }}s
			</div>
		</div>
	</div>
</template>
