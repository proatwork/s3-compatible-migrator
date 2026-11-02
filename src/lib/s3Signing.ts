type Credentials = {
	accessKeyId: string;
	secretAccessKey: string;
};

type SignedRequestResult = {
	url: string;
	headers: Record<string, string>;
};

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function sha256Hex(data: string): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
	return hexEncode(hash);
}

function hexEncode(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSignatureKey(
	secretKey: string,
	dateStamp: string,
	region: string,
	service: string,
): Promise<ArrayBuffer> {
	const kDate = await hmacSha256(new TextEncoder().encode('AWS4' + secretKey), dateStamp);
	const kRegion = await hmacSha256(kDate, region);
	const kService = await hmacSha256(kRegion, service);
	return hmacSha256(kService, 'aws4_request');
}

function getDateStrings(): { dateStamp: string; amzDate: string } {
	const now = new Date();
	const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
	const amzDate = dateStamp + 'T' + now.toISOString().slice(11, 19).replace(/:/g, '') + 'Z';
	return { dateStamp, amzDate };
}

function uriEncodeSegment(str: string): string {
	return encodeURIComponent(str);
}

function encodeCanonicalUri(pathname: string): string {
	return pathname
		.split('/')
		.map((segment) => encodeURIComponent(decodeURIComponent(segment)))
		.join('/');
}

export async function signRequest(
	method: string,
	url: string,
	headers: Record<string, string>,
	credentials: Credentials,
	region: string,
	service: string = 's3',
): Promise<SignedRequestResult> {
	const { dateStamp, amzDate } = getDateStrings();
	const parsedUrl = new URL(url);

	const normalizedHeaders: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		normalizedHeaders[k.toLowerCase()] = v;
	}
	normalizedHeaders['host'] = parsedUrl.host;
	normalizedHeaders['x-amz-date'] = amzDate;
	normalizedHeaders['x-amz-content-sha256'] = UNSIGNED_PAYLOAD;

	const signedHeaderKeys = Object.keys(normalizedHeaders).sort();
	const signedHeadersStr = signedHeaderKeys.join(';');

	const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${normalizedHeaders[k]}\n`).join('');

	const sortedParams = [...parsedUrl.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
	const canonicalQueryString = sortedParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

	const canonicalUri = encodeCanonicalUri(parsedUrl.pathname);

	const canonicalRequest = [
		method,
		canonicalUri,
		canonicalQueryString,
		canonicalHeaders,
		signedHeadersStr,
		UNSIGNED_PAYLOAD,
	].join('\n');

	const scope = `${dateStamp}/${region}/${service}/aws4_request`;
	const canonicalRequestHash = await sha256Hex(canonicalRequest);
	const stringToSign = [ALGORITHM, amzDate, scope, canonicalRequestHash].join('\n');

	const signingKey = await getSignatureKey(credentials.secretAccessKey, dateStamp, region, service);
	const signatureBuffer = await hmacSha256(signingKey, stringToSign);
	const signature = hexEncode(signatureBuffer);

	const authorization = `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

	return {
		url,
		headers: {
			...normalizedHeaders,
			Authorization: authorization,
		},
	};
}
