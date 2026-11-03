export type MigrationStatus =
	| 'initiating'
	| 'uploading'
	| 'completing'
	| 'completed'
	| 'failed';

export type BucketConfig = {
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
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
	retryCount: number;
	throttleAttempts: number;
	isThrottled: boolean;
	throttleExhausted: boolean;
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
};
