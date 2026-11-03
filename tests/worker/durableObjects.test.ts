import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DO_CALL_CONCURRENCY, HTTP_NOT_FOUND } from '../../src/constants.ts';
import { callMigrators } from '../../src/lib/durableObjects.ts';

const HTTP_SERVER_ERROR = 500;

// Each key's Durable Object answers with the given outcome: a status code, or 'throw' for a call that doesn't get through.
function fakeEnv(outcomes: Record<string, number | 'throw'>, calls: string[] = []): Env {
	const namespace = {
		idFromName: (key: string) => key,
		get: (key: string) => ({
			fetch: async (request: Request) => {
				calls.push(`${request.method} ${new URL(request.url).pathname} ${key}`);
				const outcome = outcomes[key];
				if (outcome === 'throw') throw new Error('unreachable');
				return new Response(null, { status: outcome });
			},
		}),
	};
	return { MULTIPART_MIGRATOR: namespace } as unknown as Env;
}

describe('callMigrators', () => {
	it('sorts keys by what their Durable Object answered', async () => {
		const env = fakeEnv({ ok: 200, missing: HTTP_NOT_FOUND, broken: HTTP_SERVER_ERROR, down: 'throw' });
		const result = await callMigrators(env, ['ok', 'missing', 'broken', 'down'], '/abort', 'POST');
		assert.deepEqual(result, { succeeded: ['ok'], notFound: ['missing'], failed: ['broken', 'down'] });
	});

	it('sends the given path and method to every key, across batches', async () => {
		const keys = Array.from({ length: DO_CALL_CONCURRENCY + 3 }, (_, i) => `k${i}`);
		const calls: string[] = [];
		const result = await callMigrators(fakeEnv(Object.fromEntries(keys.map(k => [k, 200])), calls), keys, '/reset', 'DELETE');
		assert.equal(result.succeeded.length, keys.length);
		assert.deepEqual(calls, keys.map(k => `DELETE /reset ${k}`));
	});

	it('handles no keys', async () => {
		assert.deepEqual(await callMigrators(fakeEnv({}), [], '/abort', 'POST'), { succeeded: [], notFound: [], failed: [] });
	});
});
