import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const WORKER_DEV_URL = 'http://localhost:8787';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [vue()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
	},
	server: {
		proxy: {
			'/api': WORKER_DEV_URL,
		},
	},
});
