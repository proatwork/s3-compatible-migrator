import type { BucketConfig, S3ListObject } from '../types';
import { signRequest, uriEncodeSegment } from './s3Signing';
import { hasDotSegment } from './skipRules';
import { isThrottledResponse, S3ThrottledError } from './throttle';
import { decodeXmlEntities } from './xml';

function buildUrl(config: BucketConfig, key?: string): string {
	const base = config.endpoint.replace(/\/$/, '');
	if (key && hasDotSegment(key)) throw new Error(`Refusing key with a dot segment: ${key}`);
	if (key) {
		const encodedKey = key
			.split('/')
			.map((segment) => uriEncodeSegment(segment))
			.join('/');
		return `${base}/${config.bucket}/${encodedKey}`;
	}
	return `${base}/${config.bucket}`;
}

function throwIfThrottled(operation: string, status: number, body?: string): void {
	if (isThrottledResponse(status, body)) {
		throw new S3ThrottledError(`${operation} throttled: ${status}`);
	}
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
	body?: ReadableStream | string | null,
): Promise<Response> {
	const signed = await signRequest(method, url, headers, credentials(config), config.region);

	return fetch(signed.url, {
		method,
		headers: signed.headers,
		body: body ?? undefined,
		// @ts-expect-error — Cloudflare Workers supports duplex for streaming uploads
		duplex: body instanceof ReadableStream ? 'half' : undefined,
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
	throwIfThrottled('ListObjects', response.status, xml);

	if (!response.ok) {
		throw new Error(`ListObjects failed: ${response.status} — ${xml}`);
	}

	const objects: S3ListObject[] = [];
	const contentMatches = xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);
	for (const match of contentMatches) {
		const block = match[1];
		const key = decodeXmlEntities(block.match(/<Key>(.*?)<\/Key>/)?.[1] ?? '');
		const size = parseInt(block.match(/<Size>(.*?)<\/Size>/)?.[1] ?? '0', 10);
		const lastModified = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? '';
		objects.push({ key, size, lastModified });
	}

	const isTruncated = xml.includes('<IsTruncated>true</IsTruncated>');
	const rawToken = isTruncated ? xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1] : undefined;
	const nextToken = rawToken ? decodeXmlEntities(rawToken) : null;

	return { objects, nextToken };
}

export async function s3HeadObject(
	config: BucketConfig,
	key: string,
): Promise<{ size: number }> {
	const url = buildUrl(config, key);
	const response = await signedFetch('HEAD', url, config);

	if (!response.ok) {
		throwIfThrottled(`HEAD ${key}`, response.status);
		throw new Error(`HEAD ${key} failed: ${response.status} ${response.statusText}`);
	}

	return {
		size: parseInt(response.headers.get('content-length') ?? '0', 10),
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
		throwIfThrottled(`GET ${key}`, response.status, await response.text());
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
	throwIfThrottled('CreateMultipartUpload', response.status, xml);

	if (!response.ok) {
		throw new Error(`CreateMultipartUpload failed: ${response.status} — ${xml}`);
	}

	const uploadId = xml.match(/<UploadId>(.*?)<\/UploadId>/)?.[1];
	if (!uploadId) {
		throw new Error(`CreateMultipartUpload response missing UploadId: ${xml}`);
	}

	return decodeXmlEntities(uploadId);
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
		throwIfThrottled(`UploadPart ${partNumber}`, response.status, text);
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

	const response = await signedFetch('POST', url, config, headers, body);

	// This call can report an error in the body of a 200, so the body is always checked.
	const text = await response.text();
	throwIfThrottled('CompleteMultipartUpload', response.status, text);

	if (!response.ok || text.includes('<Error>')) {
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
		throwIfThrottled(`PUT ${key}`, response.status, text);
		throw new Error(`PUT ${key} failed: ${response.status} — ${text}`);
	}
}
