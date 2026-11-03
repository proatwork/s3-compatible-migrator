import { SETTING_CRON_ENABLED, SETTING_DISCOVERY_COMPLETE, SETTING_DISCOVERY_CURSOR } from '../constants.ts';

export { SETTING_CRON_ENABLED, SETTING_CRON_LAST_RAN, SETTING_DISCOVERY_COMPLETE, SETTING_DISCOVERY_CURSOR } from '../constants.ts';

// The only setting the API may change. The others are written by the Worker itself.
const ALLOWED_KEYS = new Set([SETTING_CRON_ENABLED]);

export function getSettingStatement(db: D1Database, key: string): D1PreparedStatement {
	return db.prepare('SELECT value FROM settings WHERE key = ?').bind(key);
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
	const row = await getSettingStatement(db, key).first<{ value: string }>();
	return row?.value ?? null;
}

export function settingStatement(db: D1Database, key: string, value: string): D1PreparedStatement {
	return db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value);
}

export async function writeSetting(db: D1Database, key: string, value: string): Promise<void> {
	await settingStatement(db, key, value).run();
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
	if (!ALLOWED_KEYS.has(key)) throw new Error(`Unknown setting: ${key}`);
	await writeSetting(db, key, value);
}

export async function resetDiscovery(db: D1Database): Promise<void> {
	await db.prepare('DELETE FROM settings WHERE key IN (?, ?)').bind(SETTING_DISCOVERY_COMPLETE, SETTING_DISCOVERY_CURSOR).run();
}

// Paused unless Start was pressed, so a fresh install doesn't start copying on its own.
export function parseCronEnabled(value: string | null | undefined): boolean {
	return value === 'true';
}

export async function isCronEnabled(db: D1Database): Promise<boolean> {
	return parseCronEnabled(await getSetting(db, SETTING_CRON_ENABLED));
}
