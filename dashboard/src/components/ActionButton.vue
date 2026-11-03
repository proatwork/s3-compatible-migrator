<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

const RESULT_DISPLAY_MS = 3000;
const CONFIRM_WINDOW_MS = 4000;
const ERROR_LABEL = 'Error';

type Phase = 'idle' | 'confirm' | 'pending' | 'result';

const props = withDefaults(
	defineProps<{
		idleLabel: string;
		pendingLabel: string;
		action: () => Promise<string>;
		/**
		 * Whether the action is currently offered. Succeeding usually makes this false (Abort All
		 * empties In Progress), so the button stays rendered until its result has been shown.
		 */
		visible?: boolean;
		disabled?: boolean;
		/** When set, the first click only arms the button and shows this label. A second click runs the action. */
		confirmLabel?: string;
	}>(),
	{ visible: true, disabled: false },
);

const emit = defineEmits<{
	done: [];
}>();

const phase = ref<Phase>('idle');
const resultLabel = ref('');
let resetTimer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;

const label = computed(() => {
	if (phase.value === 'confirm') return props.confirmLabel;
	if (phase.value === 'pending') return props.pendingLabel;
	if (phase.value === 'result') return resultLabel.value;
	return props.idleLabel;
});

async function run() {
	if (phase.value === 'idle' && props.confirmLabel) {
		phase.value = 'confirm';
		resetTimer = setTimeout(() => {
			phase.value = 'idle';
		}, CONFIRM_WINDOW_MS);
		return;
	}
	if (phase.value !== 'idle' && phase.value !== 'confirm') return;
	clearTimeout(resetTimer);
	phase.value = 'pending';

	let succeeded = false;
	try {
		resultLabel.value = await props.action();
		succeeded = true;
	} catch {
		resultLabel.value = ERROR_LABEL;
	}
	if (unmounted) return;

	phase.value = 'result';
	resetTimer = setTimeout(() => {
		phase.value = 'idle';
	}, RESULT_DISPLAY_MS);
	if (succeeded) emit('done');
}

onBeforeUnmount(() => {
	unmounted = true;
	clearTimeout(resetTimer);
});
</script>

<template>
	<button v-if="visible || phase !== 'idle'" type="button" :disabled="disabled || phase === 'pending' || phase === 'result'" @click="run">{{ label }}</button>
</template>
