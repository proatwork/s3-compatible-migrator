import type { BucketConfig, StorageProvider } from '../types';

export function buildSourceConfig(env: Env): BucketConfig {
	return {
		provider: env.SOURCE_PROVIDER as StorageProvider,
		endpoint: env.SOURCE_ENDPOINT,
		bucket: env.SOURCE_BUCKET,
		region: env.SOURCE_REGION,
		accessKeyId: env.SOURCE_ACCESS_KEY_ID,
		secretAccessKey: env.SOURCE_SECRET_ACCESS_KEY,
	};
}

export function buildDestinationConfig(env: Env): BucketConfig {
	return {
		provider: env.DESTINATION_PROVIDER as StorageProvider,
		endpoint: env.DESTINATION_ENDPOINT,
		bucket: env.DESTINATION_BUCKET,
		region: env.DESTINATION_REGION,
		accessKeyId: env.DESTINATION_ACCESS_KEY_ID,
		secretAccessKey: env.DESTINATION_SECRET_ACCESS_KEY,
	};
}
