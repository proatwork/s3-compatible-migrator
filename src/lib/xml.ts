const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
};
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_MIN = 0xd800;
const SURROGATE_MAX = 0xdfff;
const ENTITY_PATTERN = /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g;

function isDecodableCodePoint(codePoint: number): boolean {
	return codePoint > 0 && codePoint <= MAX_CODE_POINT && (codePoint < SURROGATE_MIN || codePoint > SURROGATE_MAX);
}

// A single pass, so an escaped entity such as `&amp;lt;` decodes to the literal text `&lt;` and no further.
export function decodeXmlEntities(text: string): string {
	return text.replace(ENTITY_PATTERN, (entity, hex?: string, decimal?: string, named?: string) => {
		if (named) return NAMED_ENTITIES[named];
		const codePoint = hex ? parseInt(hex, 16) : Number(decimal);
		return isDecodableCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
	});
}
