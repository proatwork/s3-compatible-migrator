export type MigrationStatus =
	| 'pending'
	| 'initiating'
	| 'uploading'
	| 'completing'
	| 'completed'
	| 'failed';

export type StorageProvider = 's3' | 'r2' | 'b2';

export type BucketConfig = {
	provider: StorageProvider;
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
};

export type MigrationJob = {
	fileKey: string;
	fileSize: number;
	sourceBucket: BucketConfig;
	destinationBucket: BucketConfig;
};

export type MigrationState = {
	status: MigrationStatus;
	fileKey: string;
	fileSize: number;
	totalChunks: number;
	uploadId: string | null;
	completedChunks: number;
	eTags: Record<number, string>;
	lastProcessedChunk: number;
	errorMessage: string | null;
	retryCount: number;
	createdAt: number;
	updatedAt: number;
};

export type QueueMessage = {
	fileKey: string;
	fileSize: number;
};

export type S3ListObject = {
	key: string;
	size: number;
	lastModified: string;
	etag: string;
};
