<script setup lang="ts">
import { useTemplateRef } from 'vue';
import ActivityTable from './components/ActivityTable.vue';
import DashboardHeader from './components/DashboardHeader.vue';
import MigrationGrid from './components/MigrationGrid.vue';
import SourceFiles from './components/SourceFiles.vue';
import SummaryCards from './components/SummaryCards.vue';
import { useDashboard } from './useDashboard';

const CONNECTION_LOST_MESSAGE = 'Connection lost. Retrying...';

const { data, refreshing, connectionLost, refresh, setCronEnabled } = useDashboard();
const sourceFiles = useTemplateRef('sourceFiles');

function onControlDone() {
	void refresh();
	void sourceFiles.value?.reload();
}
</script>

<template>
	<template v-if="data">
		<DashboardHeader
			:cron-enabled="data.cronEnabled"
			:cron-last-ran="data.cronLastRan"
			:discovery-complete="data.discoveryComplete"
			:in-progress="data.summary.inProgress + data.summary.throttled"
			:refreshing="refreshing"
			@toggle-cron="setCronEnabled"
			@done="onControlDone"
		/>
		<SummaryCards :summary="data.summary" @done="onControlDone" />
		<MigrationGrid :migrations="data.migrations" />
		<h2>Activity</h2>
		<ActivityTable :rows="data.tableRows" @done="onControlDone" />
		<SourceFiles ref="sourceFiles" />
		<p v-if="connectionLost" class="connection-lost" role="status">{{ CONNECTION_LOST_MESSAGE }}</p>
	</template>
	<p v-else class="empty" role="status">{{ connectionLost ? CONNECTION_LOST_MESSAGE : 'Loading...' }}</p>
</template>
