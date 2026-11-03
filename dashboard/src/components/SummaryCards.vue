<script setup lang="ts">
import type { DashboardData } from '../../../src/dashboard/types';
import { abortAll, retryFailed } from '../api';
import { formatBytes } from '../format';
import ActionButton from './ActionButton.vue';

defineProps<{
	summary: DashboardData['summary'];
}>();

const emit = defineEmits<{
	done: [];
}>();

async function abortAllJobs(): Promise<string> {
	const { aborted, unreachable } = await abortAll();
	return unreachable > 0 ? `Aborted ${aborted}, ${unreachable} unreachable` : `Aborted ${aborted} jobs`;
}

async function retryFailedJobs(): Promise<string> {
	const { retried } = await retryFailed();
	return `Retried ${retried} jobs`;
}
</script>

<template>
	<div class="summary">
		<div class="card">
			<div class="label">Total</div>
			<div class="value">{{ summary.total }}</div>
		</div>
		<div class="card completed">
			<div class="label">Completed</div>
			<div class="value">{{ summary.completed }}</div>
		</div>
		<div class="card in-progress">
			<div class="label">In Progress</div>
			<div class="value">{{ summary.inProgress }}</div>
			<ActionButton
				class="abort-btn"
				idle-label="Abort All"
				confirm-label="Confirm abort?"
				pending-label="Aborting..."
				:action="abortAllJobs"
				:visible="summary.inProgress + summary.throttled > 0"
				@done="emit('done')"
			/>
		</div>
		<div v-if="summary.throttled > 0" class="card throttled">
			<div class="label">Throttled</div>
			<div class="value">{{ summary.throttled }}</div>
		</div>
		<div v-if="summary.queued > 0" class="card queued">
			<div class="label">Queued</div>
			<div class="value">{{ summary.queued }}</div>
		</div>
		<div v-if="summary.skipped > 0" class="card skipped">
			<div class="label">Skipped</div>
			<div class="value">{{ summary.skipped }}</div>
		</div>
		<div class="card failed">
			<div class="label">Failed</div>
			<div class="value">{{ summary.failed }}</div>
			<ActionButton
				class="retry-btn"
				idle-label="Retry All Failed"
				pending-label="Retrying..."
				:action="retryFailedJobs"
				:visible="summary.failed > 0"
				@done="emit('done')"
			/>
		</div>
		<div class="card">
			<div class="label">Data Migrated</div>
			<div class="value">{{ formatBytes(summary.completedBytes) }}</div>
		</div>
	</div>
</template>
