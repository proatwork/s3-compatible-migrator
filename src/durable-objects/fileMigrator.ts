import { DurableObject } from 'cloudflare:workers';
import {
	ALARM_CYCLE_DELAY_MS,
	AUTO_CLEANUP_DELAY_MS,
	CHUNK_SIZE_BYTES,
	CHUNKS_PER_ALARM_CYCLE,
	HTTP_NOT_FOUND,
	MAX_CHUNK_RETRIES,
	MAX_FILE_RETRIES,
	MS_PER_SECOND,
	STATUS_COMPLETED,
	STATUS_IN_PROGRESS,
	STATUS_THROTTLED,
	THROTTLE_RETRY_DELAYS_MS,
} from '../constants';
import {
	s3AbortMultipartUpload,
	s3CompleteMultipartUpload,
	s3CreateMultipartUpload,
	s3GetObject,
	s3HeadObject,
	s3PutObject,
	s3UploadPart,
} from '../lib/s3Client';
import { markFailedStatement, nowSeconds } from '../lib/migrationRows';
import { S3ThrottledError, throttleDelayMs } from '../lib/throttle';
import { buildDestinationConfig, buildSourceConfig } from '../lib/buildBucketConfigs';
import type { BucketConfig, MigrationState, QueueMessage } from '../types';

const SK_STATE = 'migrationState';
// Older versions saved both buckets' credentials here. They're deleted whenever the object wakes.
const LEGACY_CONFIG_KEYS = ['sourceBucketConfig', 'destinationBucketConfig'];

export class FileMigrator extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(() => ctx.storage.delete(LEGACY_CONFIG_KEYS).then(() => undefined));
	}

	// Read from the Worker's config on every use, so credentials never sit in storage and rotated keys apply right away.
	#source(): BucketConfig {
		return buildSourceConfig(this.env);
	}

	#destination(): BucketConfig {
		return buildDestinationConfig(this.env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/reset' && request.method === 'DELETE') {
			const state = await this.ctx.storage.get<MigrationState>(SK_STATE);
			const fileKey = state?.fileKey ?? 'unknown';
			await this.ctx.storage.deleteAlarm();
			if (state?.uploadId) {
				try {
					await s3AbortMultipartUpload(this.#destination(), state.fileKey, state.uploadId);
				} catch (e) {
					console.warn(`[DO] ${state.fileKey} — reset cleanup failed: ${(e as Error).message}`);
				}
			}
			await this.ctx.storage.deleteAll();
			return new Response(`Reset DO for ${fileKey}`);
		}

		if (url.pathname === '/abort' && request.method === 'POST') {
			const state = await this.ctx.storage.get<MigrationState>(SK_STATE);
			if (!state) return new Response('No state', { status: HTTP_NOT_FOUND });

			await this.ctx.storage.deleteAlarm();

			if (state.uploadId) {
				try {
					await s3AbortMultipartUpload(this.#destination(), state.fileKey, state.uploadId);
					state.uploadId = null;
				} catch (e) {
					console.warn(`[DO] ${state.fileKey} — abort cleanup failed: ${(e as Error).message}`);
				}
			}

			state.status = 'failed';
			state.updatedAt = Date.now();
			await this.ctx.storage.put(SK_STATE, state);

			return new Response(JSON.stringify({ status: 'failed', fileKey: state.fileKey }), {
				headers: { 'content-type': 'application/json' },
			});
		}

		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 });
		}

		const job = (await request.json()) as QueueMessage;
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
			retryCount: 0,
			throttleAttempts: 0,
			isThrottled: false,
			throttleExhausted: false,
			createdAt: now,
			updatedAt: now,
		};

		await this.ctx.storage.put(SK_STATE, state);

		await this.ctx.storage.setAlarm(Date.now() + ALARM_CYCLE_DELAY_MS);

		return new Response(JSON.stringify({ status: state.status }), {
			headers: { 'content-type': 'application/json' },
		});
	}

	async alarm(): Promise<void> {
		const state = await this.ctx.storage.get<MigrationState>(SK_STATE);
		if (!state) return;

		// Only reached when recording a failure threw, so the platform retried the alarm. Let another throw retry it again.
		if (state.status === 'failed') {
			await this.#recordFailure(state);
			return;
		}

		try {
			let cycleWasClean = true;
			switch (state.status) {
				case 'initiating':
					await this.#initiateMultipartUpload(state);
					break;
				case 'uploading':
					cycleWasClean = await this.#processChunkBatch(state);
					break;
				case 'completing':
					await this.#completeUpload(state);
					break;
				case 'completed':
					await this.#cleanup();
					return;
				default:
					return;
			}
			if (cycleWasClean) await this.#clearThrottle(state);
		} catch (error) {
			if (await this.#isSuperseded(state)) return;
			if (error instanceof S3ThrottledError) {
				await this.#handleThrottled(state, error);
			} else {
				await this.#handleFailure(state, error as Error);
			}
		}
	}

	// An abort or reset can land while this alarm waits on S3. Writing the stale in-memory state back would undo it.
	async #isSuperseded(state: MigrationState): Promise<boolean> {
		const current = await this.ctx.storage.get<MigrationState>(SK_STATE);
		return !current || current.createdAt !== state.createdAt || current.status === 'failed';
	}

	async #initiateMultipartUpload(state: MigrationState): Promise<void> {
		const dest = this.#destination();
		const alreadyCopied = await this.#isAlreadyInDestination(dest, state);
		if (await this.#isSuperseded(state)) return;

		if (alreadyCopied) {
			console.log(`[DO] ${state.fileKey} — already in destination, skipping copy`);
			await this.#markCompleted(state);
			return;
		}

		const uploadId = await s3CreateMultipartUpload(dest, state.fileKey);

		if (await this.#isSuperseded(state)) {
			await s3AbortMultipartUpload(dest, state.fileKey, uploadId).catch((e: Error) => {
				console.warn(`[DO] ${state.fileKey} — abort cleanup failed: ${e.message}`);
			});
			return;
		}

		state.uploadId = uploadId;
		state.status = 'uploading';
		state.updatedAt = Date.now();
		await this.ctx.storage.put(SK_STATE, state);

		await this.ctx.storage.setAlarm(Date.now() + ALARM_CYCLE_DELAY_MS);
	}

	// Returns whether the cycle was free of hard failures, which is what allows a throttled job to count as recovered.
	async #processChunkBatch(state: MigrationState): Promise<boolean> {
		const source = this.#source();
		const dest = this.#destination();

		const chunksToProcess: number[] = [];
		let nextChunk = state.lastProcessedChunk + 1;
		while (chunksToProcess.length < CHUNKS_PER_ALARM_CYCLE && nextChunk <= state.totalChunks) {
			if (!state.eTags[nextChunk]) chunksToProcess.push(nextChunk);
			nextChunk++;
		}

		if (chunksToProcess.length === 0) {
			state.status = 'completing';
			state.updatedAt = Date.now();
			await this.ctx.storage.put(SK_STATE, state);
			await this.ctx.storage.setAlarm(Date.now() + ALARM_CYCLE_DELAY_MS);
			return true;
		}

		const results = await Promise.allSettled(
			chunksToProcess.map(partNumber => this.#transferChunk(source, dest, state, partNumber)),
		);

		if (await this.#isSuperseded(state)) return false;

		let hasFailure = false;
		let throttledError: S3ThrottledError | null = null;
		let madeProgress = false;
		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			const partNumber = chunksToProcess[i];

			if (result.status === 'fulfilled') {
				state.eTags[partNumber] = result.value;
				madeProgress = true;
			} else if (result.reason instanceof S3ThrottledError) {
				throttledError = result.reason;
			} else {
				hasFailure = true;
				console.warn(`[DO] ${state.fileKey} — chunk ${partNumber} failed (retry ${state.retryCount + 1}/${MAX_CHUNK_RETRIES}): ${(result.reason as Error)?.message}`);
			}
		}

		state.completedChunks = Object.keys(state.eTags).length;
		// A job only gives up after the whole schedule passes with no progress at all.
		if (madeProgress) state.throttleAttempts = 0;

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
		} else if (!throttledError || madeProgress) {
			state.retryCount = 0;
		}

		if (state.lastProcessedChunk >= state.totalChunks) {
			state.status = 'completing';
		}
		await this.ctx.storage.put(SK_STATE, state);

		// Only the dashboard reads this, so a failed write must not cost the parts already uploaded.
		try {
			await this.env.MIGRATION_DB.prepare(
				'UPDATE migrations SET chunks_done = ?, updated_at = ? WHERE key = ?',
			).bind(state.completedChunks, nowSeconds(), state.fileKey).run();
		} catch (e) {
			console.warn(`[DO] ${state.fileKey} — could not record progress: ${(e as Error).message}`);
		}

		if (throttledError) throw throttledError;

		// An abort or reset can land during the D1 write above, and must not get an alarm back.
		if (await this.#isSuperseded(state)) return false;
		await this.ctx.storage.setAlarm(Date.now() + ALARM_CYCLE_DELAY_MS);
		return !hasFailure;
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
		const dest = this.#destination();

		if (state.totalChunks === 0) {
			const sourceResponse = await s3GetObject(this.#source(), state.fileKey);
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

		if (await this.#isSuperseded(state)) return;

		await this.#markCompleted(state);
	}

	// A failed check just means the file gets copied: a key that can't read the destination shouldn't block migrating to it.
	async #isAlreadyInDestination(dest: BucketConfig, state: MigrationState): Promise<boolean> {
		try {
			const { size } = await s3HeadObject(dest, state.fileKey);
			return size === state.fileSize;
		} catch (error) {
			if (error instanceof S3ThrottledError) throw error;
			return false;
		}
	}

	async #handleThrottled(state: MigrationState, error: S3ThrottledError): Promise<void> {
		const attempt = state.throttleAttempts ?? 0;
		const delayMs = throttleDelayMs(attempt);

		if (delayMs === null) {
			await this.#handleFailure(state, new Error(`Still throttled after ${THROTTLE_RETRY_DELAYS_MS.length} retries: ${error.message}`), true);
			return;
		}

		console.warn(`[DO] ${state.fileKey} — ${error.message}, retry ${attempt + 1}/${THROTTLE_RETRY_DELAYS_MS.length} in ${Math.round(delayMs / MS_PER_SECOND)}s`);

		state.throttleAttempts = attempt + 1;
		state.isThrottled = true;
		state.updatedAt = Date.now();
		await this.ctx.storage.put(SK_STATE, state);
		await this.ctx.storage.setAlarm(Date.now() + delayMs);

		// Only the dashboard reads this, so a failed write must not disturb the retry.
		try {
			const now = nowSeconds();
			await this.env.MIGRATION_DB.prepare(
				'UPDATE migrations SET status = ?, throttle_attempts = ?, next_retry_at = ?, updated_at = ? WHERE key = ?',
			).bind(STATUS_THROTTLED, state.throttleAttempts, now + Math.ceil(delayMs / MS_PER_SECOND), now, state.fileKey).run();
		} catch (e) {
			console.warn(`[DO] ${state.fileKey} — could not record throttling: ${(e as Error).message}`);
		}
	}

	async #clearThrottle(state: MigrationState): Promise<void> {
		if (!state.isThrottled || await this.#isSuperseded(state)) return;

		try {
			await this.env.MIGRATION_DB.prepare(
				'UPDATE migrations SET status = ?, throttle_attempts = 0, next_retry_at = NULL WHERE key = ? AND status = ?',
			).bind(STATUS_IN_PROGRESS, state.fileKey, STATUS_THROTTLED).run();
		} catch (e) {
			console.warn(`[DO] ${state.fileKey} — could not clear throttling: ${(e as Error).message}`);
			return;
		}

		// Writing the stale copy back would undo an abort or reset that landed during the D1 write.
		if (await this.#isSuperseded(state)) return;
		state.isThrottled = false;
		state.throttleAttempts = 0;
		await this.ctx.storage.put(SK_STATE, state);
	}

	async #markCompleted(state: MigrationState): Promise<void> {
		state.status = 'completed';
		state.updatedAt = Date.now();
		await this.ctx.storage.put(SK_STATE, state);

		await this.env.MIGRATION_DB.prepare(
			'UPDATE migrations SET status = ?, completed_at = ?, chunks_done = ?, throttle_attempts = 0, next_retry_at = NULL WHERE key = ?',
		).bind(STATUS_COMPLETED, nowSeconds(), state.totalChunks, state.fileKey).run();

		if (await this.#isSuperseded(state)) return;
		await this.ctx.storage.setAlarm(Date.now() + AUTO_CLEANUP_DELAY_MS);
	}

	// Exhausted jobs use up their automatic retries, so failing them is final until someone presses Start or Retry.
	async #handleFailure(state: MigrationState, error: Error, exhausted: boolean = false): Promise<void> {
		console.error(`[DO] ${state.fileKey} — FAILED: ${error.message}`);

		// A failed abort keeps the upload ID, so a later reset can try again.
		if (state.uploadId) {
			try {
				console.log(`[DO] ${state.fileKey} — aborting multipart upload`);
				await s3AbortMultipartUpload(this.#destination(), state.fileKey, state.uploadId);
				state.uploadId = null;
			} catch (abortError) {
				console.error(`[DO] ${state.fileKey} — failed to abort multipart upload: ${(abortError as Error).message}`);
			}
		}

		state.status = 'failed';
		state.isThrottled = false;
		state.throttleExhausted = exhausted;
		state.updatedAt = Date.now();
		await this.ctx.storage.put(SK_STATE, state);

		await this.#recordFailure(state);
	}

	async #recordFailure(state: MigrationState): Promise<void> {
		await markFailedStatement(this.env.MIGRATION_DB, 'key = ?', state.throttleExhausted ? MAX_FILE_RETRIES : 0, state.fileKey).run();
	}

	async #cleanup(): Promise<void> {
		const state = await this.ctx.storage.get<MigrationState>(SK_STATE);
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
		console.log(`[DO] ${state?.fileKey ?? 'unknown'} — cleaned up`);
	}
}
