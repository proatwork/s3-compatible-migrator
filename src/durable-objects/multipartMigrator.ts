import { DurableObject } from 'cloudflare:workers';
import {
	ALARM_CYCLE_DELAY_MS,
	AUTO_CLEANUP_DELAY_MS,
	CHUNK_SIZE_BYTES,
	CHUNKS_PER_ALARM_CYCLE,
	MAX_CHUNK_RETRIES,
} from '../constants';
import {
	s3AbortMultipartUpload,
	s3CompleteMultipartUpload,
	s3CreateMultipartUpload,
	s3GetObject,
	s3PutObject,
	s3UploadPart,
} from '../lib/s3Client';
import type { BucketConfig, MigrationJob, MigrationState } from '../types';

const SK_STATE = 'migrationState';
const SK_SOURCE = 'sourceBucketConfig';
const SK_DESTINATION = 'destinationBucketConfig';

export class MultipartMigratorV4 extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/reset' && request.method === 'DELETE') {
			const state = await this.ctx.storage.get<MigrationState>(SK_STATE);
			const fileKey = state?.fileKey ?? 'unknown';
			await this.ctx.storage.deleteAlarm();
			await this.ctx.storage.deleteAll();
			return new Response(`Reset DO for ${fileKey}`);
		}

		if (url.pathname === '/abort' && request.method === 'POST') {
			const state = await this.ctx.storage.get<MigrationState>(SK_STATE);
			if (!state) return new Response('No state', { status: 404 });

			await this.ctx.storage.deleteAlarm();

			if (state.uploadId) {
				try {
					const dest = await this.ctx.storage.get<BucketConfig>(SK_DESTINATION);
					if (dest) await s3AbortMultipartUpload(dest, state.fileKey, state.uploadId);
				} catch (e) {
					console.warn(`[DO] ${state.fileKey} — abort cleanup failed: ${(e as Error).message}`);
				}
			}

			state.status = 'failed';
			state.errorMessage = 'Manually aborted';
			state.updatedAt = Date.now();
			await this.ctx.storage.put(SK_STATE, state);

			return new Response(JSON.stringify({ status: 'failed', fileKey: state.fileKey }), {
				headers: { 'content-type': 'application/json' },
			});
		}

		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 });
		}

		const job = (await request.json()) as MigrationJob;
		const existingState = await this.ctx.storage.get<MigrationState>(SK_STATE);

		if (existingState && existingState.status !== 'failed' && existingState.status !== 'completed') {
			console.log(`[DO] ${job.fileKey} — already in progress (status: ${existingState.status})`);
			return new Response(JSON.stringify({ status: existingState.status }), {
				headers: { 'content-type': 'application/json' },
			});
		}

		const now = Date.now();
		const totalChunks = Math.ceil(job.fileSize / CHUNK_SIZE_BYTES);

		console.log(`[DO] ${job.fileKey} — starting migration (${(job.fileSize / 1024 / 1024).toFixed(1)}MB, ${totalChunks} chunks)`);

		const state: MigrationState = {
			status: totalChunks === 0 ? 'completing' : 'initiating',
			fileKey: job.fileKey,
			fileSize: job.fileSize,
			totalChunks,
			uploadId: null,
			completedChunks: 0,
			eTags: {},
			lastProcessedChunk: 0,
			errorMessage: null,
			retryCount: 0,
			createdAt: now,
			updatedAt: now,
		};

		await Promise.all([
			this.ctx.storage.put(SK_STATE, state),
			this.ctx.storage.put(SK_SOURCE, job.sourceBucket),
			this.ctx.storage.put(SK_DESTINATION, job.destinationBucket),
		]);

		await this.ctx.storage.setAlarm(Date.now() + ALARM_CYCLE_DELAY_MS);

		return new Response(JSON.stringify({ status: state.status }), {
			headers: { 'content-type': 'application/json' },
		});
	}

	async alarm(): Promise<void> {
		const state = await this.ctx.storage.get<MigrationState>(SK_STATE);
		if (!state) return;

		try {
			switch (state.status) {
				case 'initiating':
					await this.#initiateMultipartUpload(state);
					break;
				case 'uploading':
					await this.#processChunkBatch(state);
					break;
				case 'completing':
					await this.#completeUpload(state);
					break;
				case 'completed':
					await this.#cleanup();
					break;
				default:
					break;
			}
		} catch (error) {
			await this.#handleFailure(state, error as Error);
		}
	}

	async #initiateMultipartUpload(state: MigrationState): Promise<void> {
		const dest = await this.ctx.storage.get<BucketConfig>(SK_DESTINATION);
		if (!dest) throw new Error('Destination config missing');

		const uploadId = await s3CreateMultipartUpload(dest, state.fileKey);

		state.uploadId = uploadId;
		state.status = 'uploading';
		state.updatedAt = Date.now();
		await this.ctx.storage.put(SK_STATE, state);

		await this.ctx.storage.setAlarm(Date.now() + ALARM_CYCLE_DELAY_MS);
	}

	async #processChunkBatch(state: MigrationState): Promise<void> {
		const [source, dest] = await Promise.all([
			this.ctx.storage.get<BucketConfig>(SK_SOURCE),
			this.ctx.storage.get<BucketConfig>(SK_DESTINATION),
		]);
		if (!source || !dest) throw new Error('Bucket configs missing');

		const chunksToProcess: number[] = [];
		let nextChunk = state.lastProcessedChunk + 1;
		while (chunksToProcess.length < CHUNKS_PER_ALARM_CYCLE && nextChunk <= state.totalChunks) {
			chunksToProcess.push(nextChunk);
			nextChunk++;
		}

		if (chunksToProcess.length === 0) {
			state.status = 'completing';
			state.updatedAt = Date.now();
			await this.ctx.storage.put(SK_STATE, state);
			await this.ctx.storage.setAlarm(Date.now() + ALARM_CYCLE_DELAY_MS);
			return;
		}

		const results = await Promise.allSettled(
			chunksToProcess.map(partNumber => this.#transferChunk(source, dest, state, partNumber)),
		);

		let hasFailure = false;
		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			const partNumber = chunksToProcess[i];
			const startByte = (partNumber - 1) * CHUNK_SIZE_BYTES;
			const endByte = Math.min(partNumber * CHUNK_SIZE_BYTES - 1, state.fileSize - 1);
			const chunkSize = endByte - startByte + 1;

			if (result.status === 'fulfilled') {
				state.eTags[partNumber] = result.value;
				state.completedChunks++;
			} else {
				hasFailure = true;
				console.warn(`[DO] ${state.fileKey} — chunk ${partNumber} failed (retry ${state.retryCount + 1}/${MAX_CHUNK_RETRIES}): ${(result.reason as Error)?.message}`);
			}
		}

		// Advance lastProcessedChunk to the highest contiguous completed part
		while (state.lastProcessedChunk < state.totalChunks && state.eTags[state.lastProcessedChunk + 1]) {
			state.lastProcessedChunk++;
		}

		state.updatedAt = Date.now();

		if (hasFailure) {
			state.retryCount++;
			if (state.retryCount >= MAX_CHUNK_RETRIES) {
				await this.ctx.storage.put(SK_STATE, state);
				throw new Error(`Chunks failed after ${MAX_CHUNK_RETRIES} retries`);
			}
		} else {
			state.retryCount = 0;
		}

		if (state.lastProcessedChunk >= state.totalChunks) {
			state.status = 'completing';
		}
		await this.ctx.storage.put(SK_STATE, state);

		await this.env.MIGRATION_DB.prepare(
			'UPDATE migrations SET chunks_done = ? WHERE key = ?',
		).bind(state.completedChunks, state.fileKey).run();

		await this.ctx.storage.setAlarm(Date.now() + ALARM_CYCLE_DELAY_MS);
	}

	async #transferChunk(
		source: BucketConfig,
		dest: BucketConfig,
		state: MigrationState,
		partNumber: number,
	): Promise<string> {
		const startByte = (partNumber - 1) * CHUNK_SIZE_BYTES;
		const endByte = Math.min(partNumber * CHUNK_SIZE_BYTES - 1, state.fileSize - 1);
		const contentLength = endByte - startByte + 1;

		const sourceResponse = await s3GetObject(source, state.fileKey, { startByte, endByte });

		if (!sourceResponse.body) {
			throw new Error(`Source returned no body for chunk ${partNumber}`);
		}

		return s3UploadPart(dest, state.fileKey, state.uploadId!, partNumber, sourceResponse.body, contentLength);
	}

	async #completeUpload(state: MigrationState): Promise<void> {
		const source = await this.ctx.storage.get<BucketConfig>(SK_SOURCE);
		const dest = await this.ctx.storage.get<BucketConfig>(SK_DESTINATION);
		if (!dest) throw new Error('Destination config missing');

		if (state.totalChunks === 0) {
			if (!source) throw new Error('Source config missing');
			const sourceResponse = await s3GetObject(source, state.fileKey);
			if (sourceResponse.body) {
				await s3PutObject(dest, state.fileKey, sourceResponse.body, state.fileSize);
			}
		} else {
			const parts = Object.entries(state.eTags).map(([num, etag]) => ({
				partNumber: parseInt(num, 10),
				etag,
			}));
			await s3CompleteMultipartUpload(dest, state.fileKey, state.uploadId!, parts);
		}

		state.status = 'completed';
		state.updatedAt = Date.now();
		await this.ctx.storage.put(SK_STATE, state);

		await this.env.MIGRATION_DB.prepare(
			'UPDATE migrations SET status = ?, completed_at = ? WHERE key = ?',
		).bind('completed', Math.floor(Date.now() / 1000), state.fileKey).run();

		await this.ctx.storage.setAlarm(Date.now() + AUTO_CLEANUP_DELAY_MS);

	}

	async #handleFailure(state: MigrationState, error: Error): Promise<void> {
		console.error(`[DO] ${state.fileKey} — FAILED: ${error.message}`);

		state.status = 'failed';
		state.errorMessage = error.message;
		state.updatedAt = Date.now();
		await this.ctx.storage.put(SK_STATE, state);

		await this.env.MIGRATION_DB.prepare(
			'UPDATE migrations SET status = ?, failed_at = ? WHERE key = ?',
		).bind('failed', Math.floor(Date.now() / 1000), state.fileKey).run();

		if (state.uploadId) {
			try {
				const dest = await this.ctx.storage.get<BucketConfig>(SK_DESTINATION);
				if (dest) {
					console.log(`[DO] ${state.fileKey} — aborting multipart upload`);
					await s3AbortMultipartUpload(dest, state.fileKey, state.uploadId);
				}
			} catch (abortError) {
				console.error(`[DO] ${state.fileKey} — failed to abort multipart upload: ${(abortError as Error).message}`);
			}
		}
	}

	async #cleanup(): Promise<void> {
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
		console.log(`🧹 cleanup complete`);
	}
}
