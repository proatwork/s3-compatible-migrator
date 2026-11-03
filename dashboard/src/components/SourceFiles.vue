<script setup lang="ts">
import { onMounted } from 'vue';
import { fetchSourceFiles } from '../api';
import { formatBytes, formatIsoTimestamp, statusClass, statusLabel, truncateKey } from '../format';
import { useSourceFiles } from '../useSourceFiles';

const COLUMNS = ['File Key', 'Status', 'Size', 'Last Modified'];
const NOT_STARTED_LABEL = 'not started';
const NOT_STARTED_CLASS = 'not-started';

const { files, loading, failed, pageNumber, hasPrevious, hasNext, reload, next, previous } = useSourceFiles(fetchSourceFiles);

onMounted(reload);

defineExpose({ reload });
</script>

<template>
	<section class="source-files">
		<h2>Source Files</h2>
		<table>
			<thead>
				<tr>
					<th v-for="column in COLUMNS" :key="column">{{ column }}</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="file in files" :key="file.key">
					<td class="key" :title="file.key">{{ truncateKey(file.key) }}</td>
					<td>
						<span class="badge" :class="file.status === null ? NOT_STARTED_CLASS : statusClass(file.status)">
							{{ file.status === null ? NOT_STARTED_LABEL : statusLabel(file.status) }}
						</span>
					</td>
					<td>{{ formatBytes(file.size) }}</td>
					<td>{{ formatIsoTimestamp(file.lastModified) }}</td>
				</tr>
				<tr v-if="files.length === 0">
					<td :colspan="COLUMNS.length" class="empty" :class="{ 'failed-state': failed }" role="status">
						<template v-if="failed">Could not list source files.</template>
						<template v-else-if="loading">Loading...</template>
						<template v-else>No files found</template>
					</td>
				</tr>
			</tbody>
		</table>
		<div class="table-footer">
			<button type="button" class="page-btn" :disabled="loading || !hasPrevious" @click="previous">Previous</button>
			<span>Page {{ pageNumber }}</span>
			<button v-if="failed" type="button" class="page-btn" :disabled="loading" @click="reload">Retry</button>
			<button v-else type="button" class="page-btn" :disabled="loading || !hasNext" @click="next">Next</button>
		</div>
	</section>
</template>
