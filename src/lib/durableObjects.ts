import { DO_BASE_URL, DO_CALL_CONCURRENCY, HTTP_NOT_FOUND } from '../constants.ts';

export function migratorStub(env: Env, key: string): DurableObjectStub {
	return env.MULTIPART_MIGRATOR.get(env.MULTIPART_MIGRATOR.idFromName(key));
}

// notFound means the object had no job, so nothing was running. failed means the call didn't get through, so a job may still be running.
export type MigratorCallResult = { succeeded: string[]; notFound: string[]; failed: string[] };

// Calls each file's Durable Object a batch at a time, so a large table doesn't open thousands of requests at once.
export async function callMigrators(env: Env, keys: string[], path: string, method: string): Promise<MigratorCallResult> {
	const result: MigratorCallResult = { succeeded: [], notFound: [], failed: [] };

	for (let i = 0; i < keys.length; i += DO_CALL_CONCURRENCY) {
		const batch = keys.slice(i, i + DO_CALL_CONCURRENCY);
		const responses = await Promise.allSettled(
			batch.map(key => {
				return migratorStub(env, key).fetch(new Request(`${DO_BASE_URL}${path}`, { method }));
			}),
		);
		responses.forEach((response, idx) => {
			const status = response.status === 'fulfilled' ? response.value.status : null;
			const ok = response.status === 'fulfilled' && response.value.ok;
			const bucket = ok ? result.succeeded : status === HTTP_NOT_FOUND ? result.notFound : result.failed;
			bucket.push(batch[idx]);
		});
	}

	return result;
}

export function resetMigrators(env: Env, keys: string[]): Promise<MigratorCallResult> {
	return callMigrators(env, keys, '/reset', 'DELETE');
}

export function abortMigrators(env: Env, keys: string[]): Promise<MigratorCallResult> {
	return callMigrators(env, keys, '/abort', 'POST');
}
