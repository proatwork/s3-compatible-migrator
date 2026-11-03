<script setup lang="ts">
import { STATUS_IN_PROGRESS, STATUS_SKIPPED, STATUS_THROTTLED } from '../../../src/constants';
import type { MigrationRow } from '../../../src/dashboard/types';
import { abortJob } from '../api';
import {
	completedText,
	durationText,
	EM_DASH,
	formatBytes,
	formatTimestamp,
	progressPercent,
	retryText,
	statusClass,
	statusLabel,
	throttleText,
	truncateKey,
} from '../format';
import ActionButton from './ActionButton.vue';

const COLUMNS = ['File Key', 'Status', 'Progress', 'Size', 'Created', 'Completed', 'Duration', ''];

defineProps<{
	rows: MigrationRow[];
}>();

const emit = defineEmits<{
	done: [];
}>();

async function abortRow(key: string): Promise<string> {
	const { aborted } = await abortJob(key);
	if (!aborted) throw new Error(`Abort failed for ${key}`);
	return 'Aborted';
}
</script>

<template>
	<table>
		<thead>
			<tr>
				<th v-for="column in COLUMNS" :key="column">{{ column }}</th>
			</tr>
		</thead>
		<tbody>
			<tr v-for="m in rows" :key="m.key">
				<td class="key" :title="m.key">{{ truncateKey(m.key) }}</td>
				<td>
					<span class="badge" :class="statusClass(m.status)">{{ statusLabel(m.status) }}</span>
					<template v-if="m.skip_reason">{{ ' ' }}<span class="retry-count">({{ m.skip_reason }})</span></template>
					<template v-else-if="m.status === STATUS_THROTTLED">{{ ' ' }}<span class="retry-count">({{ throttleText(m) }})</span></template>
					<template v-else-if="m.retry_count > 0">{{ ' ' }}<span class="retry-count">({{ retryText(m.retry_count) }})</span></template>
				</td>
				<td>
					<template v-if="m.status === STATUS_SKIPPED">{{ EM_DASH }}</template>
					<div v-else class="progress-cell">
						<div class="progress-bar">
							<div class="progress-fill" :style="{ width: `${progressPercent(m)}%` }"></div>
						</div>
						<span class="progress-text">{{ m.chunks_done }}/{{ m.total_chunks }}</span>
					</div>
				</td>
				<td>{{ formatBytes(m.file_size) }}</td>
				<td>{{ formatTimestamp(Number(m.created_at)) }}</td>
				<td>{{ completedText(m) }}</td>
				<td>{{ durationText(m) }}</td>
				<td>
					<ActionButton
						class="abort-row-btn"
						idle-label="Abort"
						pending-label="..."
						:action="() => abortRow(m.key)"
						:visible="m.status === STATUS_IN_PROGRESS || m.status === STATUS_THROTTLED"
						@done="emit('done')"
					/>
				</td>
			</tr>
			<tr v-if="rows.length === 0">
				<td :colspan="COLUMNS.length" class="empty">No migrations yet</td>
			</tr>
		</tbody>
	</table>
</template>
