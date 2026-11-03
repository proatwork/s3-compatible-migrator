import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { uriEncodeSegment } from '../../src/lib/s3Signing.ts';

describe('uriEncodeSegment', () => {
	it('leaves only RFC 3986 unreserved characters unencoded', () => {
		assert.equal(uriEncodeSegment('AZaz09-._~'), 'AZaz09-._~');
	});

	it('encodes the characters encodeURIComponent leaves alone', () => {
		assert.equal(uriEncodeSegment(`!'()*`), '%21%27%28%29%2A');
	});

	it('encodes separators, spaces, plus signs and non-ASCII', () => {
		assert.equal(uriEncodeSegment('a&b/c d+eü'), 'a%26b%2Fc%20d%2Be%C3%BC');
	});
});
