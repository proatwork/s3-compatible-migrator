const ALLOWED_KEYS = new Set(['cron_enabled']);

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
	const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
	return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
	if (!ALLOWED_KEYS.has(key)) throw new Error(`Unknown setting: ${key}`);
	await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
}

export async function isCronEnabled(db: D1Database): Promise<boolean> {
	const value = await getSetting(db, 'cron_enabled');
	return value !== 'false';
}
