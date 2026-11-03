import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeXmlEntities } from '../../src/lib/xml.ts';

describe('decodeXmlEntities', () => {
	it('leaves text without entities unchanged', () => {
		assert.equal(decodeXmlEntities('videos/file (1).mp4'), 'videos/file (1).mp4');
	});

	it('decodes each predefined entity', () => {
		assert.equal(decodeXmlEntities('a&amp;b&lt;c&gt;d&quot;e&apos;f'), `a&b<c>d"e'f`);
	});

	it('decodes numeric references', () => {
		assert.equal(decodeXmlEntities('a&#38;b&#x26;c&#x1F600;'), 'a&b&c\u{1F600}');
	});

	it('decodes only once', () => {
		assert.equal(decodeXmlEntities('a&amp;lt;b&amp;amp;c'), 'a&lt;b&amp;c');
		assert.equal(decodeXmlEntities('&amp;#38;lt;'), '&#38;lt;');
		assert.equal(decodeXmlEntities('&#38;lt;'), '&lt;');
	});

	it('leaves unknown entities, bare ampersands and out-of-range references alone', () => {
		assert.equal(decodeXmlEntities('a&b &nope; &#x110000;'), 'a&b &nope; &#x110000;');
	});

	it('leaves references to characters that are illegal in XML alone', () => {
		assert.equal(decodeXmlEntities('&#0; &#xD800; &#xDFFF;'), '&#0; &#xD800; &#xDFFF;');
		assert.equal(decodeXmlEntities('&#xD7FF;&#xE000;'), '퟿');
	});
});
