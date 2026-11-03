<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue';
import { STATUS_THROTTLED } from '../../../src/constants';
import type { MigrationRow } from '../../../src/dashboard/types';
import { completedText, durationText, formatBytes, formatTimestamp, retryText, statusClass, statusLabel, throttleText } from '../format';

const GRID_CELL_SELECTOR = '.grid-cell';
const TOOLTIP_CELL_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 4;

const props = defineProps<{
	migrations: MigrationRow[];
}>();

const tooltipEl = useTemplateRef<HTMLElement>('tooltipEl');
const hoveredKey = ref<string | null>(null);
const tooltipPosition = ref<{ left: string; top: string } | null>(null);
let hoveredCell: HTMLElement | null = null;

const hoveredRow = computed(() => {
	if (hoveredKey.value === null) return null;
	return props.migrations.find((m) => m.key === hoveredKey.value) ?? null;
});

const tooltipRows = computed(() => {
	const row = hoveredRow.value;
	if (!row) return [];
	const retryNote = row.retry_count > 0 ? ` (${retryText(row.retry_count)})` : '';
	const statusNote = row.status === STATUS_THROTTLED ? ` (${throttleText(row)})` : retryNote;
	const statusSuffix = row.skip_reason ? ` (${row.skip_reason})` : statusNote;
	return [
		{ label: 'Status', value: statusLabel(row.status) + statusSuffix },
		{ label: 'Progress', value: `${row.chunks_done}/${row.total_chunks}` },
		{ label: 'Size', value: formatBytes(row.file_size) },
		{ label: 'Created', value: formatTimestamp(Number(row.created_at)) },
		{ label: 'Completed', value: completedText(row) },
		{ label: 'Duration', value: durationText(row) },
	];
});

function closestCell(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>(GRID_CELL_SELECTOR) : null;
}

function clearHover() {
	hoveredKey.value = null;
	hoveredCell = null;
}

function positionTooltip() {
	if (!tooltipEl.value || !hoveredCell) return;
	const rect = hoveredCell.getBoundingClientRect();
	const ttRect = tooltipEl.value.getBoundingClientRect();
	let left = rect.left + rect.width / 2 - ttRect.width / 2;
	let top = rect.top - ttRect.height - TOOLTIP_CELL_GAP_PX;
	if (top < VIEWPORT_MARGIN_PX) top = rect.bottom + TOOLTIP_CELL_GAP_PX;
	if (left < VIEWPORT_MARGIN_PX) left = VIEWPORT_MARGIN_PX;
	if (left + ttRect.width > window.innerWidth - VIEWPORT_MARGIN_PX) left = window.innerWidth - ttRect.width - VIEWPORT_MARGIN_PX;
	tooltipPosition.value = { left: `${left}px`, top: `${top}px` };
}

// Flushing post-render means the tooltip is displayed with its new content before it is measured.
// Keyed on hover alone: remeasuring on each poll would catch the cell mid hover-scale and shift the tooltip.
watch(hoveredKey, (key) => key !== null && positionTooltip(), { flush: 'post' });
watch(hoveredRow, (row) => row || clearHover(), { flush: 'post' });

function onMouseOver(event: MouseEvent) {
	const cell = closestCell(event.target);
	if (!cell) return;
	hoveredCell = cell;
	hoveredKey.value = cell.dataset.key ?? null;
}

function onMouseOut(event: MouseEvent) {
	const cell = closestCell(event.target);
	if (!cell || closestCell(event.relatedTarget) === cell) return;
	clearHover();
}
</script>

<template>
	<div class="grid-section">
		<div class="migration-grid" @mouseover="onMouseOver" @mouseout="onMouseOut">
			<div v-for="m in migrations" :key="m.key" class="grid-cell" :class="statusClass(m.status)" :data-key="m.key"></div>
		</div>
		<div ref="tooltipEl" class="tooltip" :style="{ display: hoveredRow ? 'block' : 'none', ...tooltipPosition }">
			<template v-if="hoveredRow">
				<div class="tt-key">{{ hoveredRow.key }}</div>
				<div v-for="row in tooltipRows" :key="row.label" class="tt-row">
					<span class="tt-label">{{ row.label }}:</span> {{ row.value }}
				</div>
			</template>
		</div>
	</div>
</template>
