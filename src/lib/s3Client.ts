import type { BucketConfig, S3ListObject } from '../types';
import { signRequest } from './s3Signing';

function buildUrl(config: BucketConfig, key?: string): string {
	const base = config.endpoint.replace(/\/$/, '');
	if (key) {
		const encodedKey = key
			.split('/')
			.map((segment) => encodeURIComponent(segment))
			.join('/');
		return `${base}/${config.bucket}/${encodedKey}`;
	}
	return `${base}/${config.bucket}`;
}

function credentials(config: BucketConfig) {
	return {
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
	};
}

async function signedFetch(
	method: string,
	url: string,
	config: BucketConfig,
	headers: Record<string, string> = {},
	body?: ReadableStream | null,
): Promise<Response> {
	const signed = await signRequest(method, url, headers, credentials(config), config.region);

	return fetch(signed.url, {
		method,
		headers: signed.headers,
		body: body ?? undefined,
		// @ts-expect-error — Cloudflare Workers supports duplex for streaming uploads
		duplex: body ? 'half' : undefined,
	});
}

export async function s3ListObjects(
	config: BucketConfig,
	prefix?: string,
	continuationToken?: string,
	maxKeys: number = 100,
	startAfter?: string,
): Promise<{ objects: S3ListObject[]; nextToken: string | null }> {
	const url = new URL(buildUrl(config));
	url.searchParams.set('list-type', '2');
	url.searchParams.set('max-keys', maxKeys.toString());
	if (prefix) url.searchParams.set('prefix', prefix);
	if (continuationToken) url.searchParams.set('continuation-token', continuationToken);
	if (startAfter) url.searchParams.set('start-after', startAfter);

	const response = await signedFetch('GET', url.toString(), config);
	const xml = await response.text();

	if (!response.ok) {
		throw new Error(`ListObjects failed: ${response.status} — ${xml}`);
	}

	const objects: S3ListObject[] = [];
	const contentMatches = xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);
	for (const match of contentMatches) {
		const block = match[1];
		const key = block.match(/<Key>(.*?)<\/Key>/)?.[1] ?? '';
		const size = parseInt(block.match(/<Size>(.*?)<\/Size>/)?.[1] ?? '0', 10);
		const lastModified = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? '';
		const etag = block.match(/<ETag>(.*?)<\/ETag>/)?.[1] ?? '';
		objects.push({ key, size, lastModified, etag });
	}

	const isTruncated = xml.includes('<IsTruncated>true</IsTruncated>');
	const nextToken = isTruncated
		? (xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1] ?? null)
		: null;

	return { objects, nextToken };
}

export async function s3HeadObject(
	config: BucketConfig,
	key: string,
): Promise<{ size: number; etag: string; lastModified: string }> {
	const url = buildUrl(config, key);
	const response = await signedFetch('HEAD', url, config);

	if (!response.ok) {
		throw new Error(`HEAD ${key} failed: ${response.status} ${response.statusText}`);
	}

	return {
		size: parseInt(response.headers.get('content-length') ?? '0', 10),
		etag: response.headers.get('etag') ?? '',
		lastModified: response.headers.get('last-modified') ?? '',
	};
}

export async function s3GetObject(
	config: BucketConfig,
	key: string,
	range?: { startByte: number; endByte: number },
): Promise<Response> {
	const url = buildUrl(config, key);
	const headers: Record<string, string> = {};
	if (range) {
		headers['range'] = `bytes=${range.startByte}-${range.endByte}`;
	}

	const response = await signedFetch('GET', url, config, headers);

	if (!response.ok) {
		throw new Error(`GET ${key} failed: ${response.status} ${response.statusText}`);
	}

	return response;
}

export async function s3CreateMultipartUpload(
	config: BucketConfig,
	key: string,
): Promise<string> {
	const url = buildUrl(config, key) + '?uploads';
	const response = await signedFetch('POST', url, config);
	const xml = await response.text();

	if (!response.ok) {
		throw new Error(`CreateMultipartUpload failed: ${response.status} — ${xml}`);
	}

	const uploadId = xml.match(/<UploadId>(.*?)<\/UploadId>/)?.[1];
	if (!uploadId) {
		throw new Error(`CreateMultipartUpload response missing UploadId: ${xml}`);
	}

	return uploadId;
}

export async function s3UploadPart(
	config: BucketConfig,
	key: string,
	uploadId: string,
	partNumber: number,
	body: ReadableStream,
	contentLength: number,
): Promise<string> {
	const baseUrl = buildUrl(config, key);
	const url = `${baseUrl}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;

	const headers: Record<string, string> = {
		'content-length': contentLength.toString(),
	};

	const response = await signedFetch('PUT', url, config, headers, body);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`UploadPart ${partNumber} failed: ${response.status} — ${text}`);
	}

	const etag = response.headers.get('etag');
	if (!etag) {
		throw new Error(`UploadPart ${partNumber} response missing ETag`);
	}

	return etag;
}

export async function s3CompleteMultipartUpload(
	config: BucketConfig,
	key: string,
	uploadId: string,
	parts: Array<{ partNumber: number; etag: string }>,
): Promise<void> {
	const baseUrl = buildUrl(config, key);
	const url = `${baseUrl}?uploadId=${encodeURIComponent(uploadId)}`;

	const partsXml = parts
		.sort((a, b) => a.partNumber - b.partNumber)
		.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
		.join('');

	const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;

	const headers: Record<string, string> = {
		'content-type': 'application/xml',
		'content-length': new TextEncoder().encode(body).length.toString(),
	};

	const signed = await signRequest('POST', url, headers, credentials(config), config.region);
	const response = await fetch(signed.url, {
		method: 'POST',
		headers: signed.headers,
		body,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`CompleteMultipartUpload failed: ${response.status} — ${text}`);
	}
}

export async function s3AbortMultipartUpload(
	config: BucketConfig,
	key: string,
	uploadId: string,
): Promise<void> {
	const baseUrl = buildUrl(config, key);
	const url = `${baseUrl}?uploadId=${encodeURIComponent(uploadId)}`;

	const response = await signedFetch('DELETE', url, config);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`AbortMultipartUpload failed: ${response.status} — ${text}`);
	}
}


export async function s3PutObject(
	config: BucketConfig,
	key: string,
	body: ReadableStream | Uint8Array,
	contentLength: number,
): Promise<void> {
	const url = buildUrl(config, key);

	const headers: Record<string, string> = {
		'content-length': contentLength.toString(),
	};

	const stream = body instanceof ReadableStream
		? body
		: new ReadableStream({ start(c) { c.enqueue(body); c.close(); } });
	const response = await signedFetch('PUT', url, config, headers, stream);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`PUT ${key} failed: ${response.status} — ${text}`);
	}
}
