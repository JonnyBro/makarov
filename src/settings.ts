import type { Config } from "./config.js";
import { db } from "./db.js";

export interface GuildSettings {
	chance: number;
	timeout: number;
	coherence: number;
	maxOverlap: number;
	mediaChance: number;
	mirror: number;
	dialogue: number;
}

export type SettingKey = keyof GuildSettings;

export const SETTINGS: Record<SettingKey, { min: number; max: number; description: string }> = {
	chance: { min: 0, max: 100, description: "% chance to reply to a random message" },
	timeout: { min: 0, max: 86400, description: "seconds between random replies" },
	coherence: { min: 0, max: 1, description: "how often two words of context are used instead of one" },
	maxOverlap: { min: 0.1, max: 1, description: "max share of a reply copied from a single message" },
	mediaChance: { min: 0, max: 100, description: "% of random replies that are links or files instead of text" },
	mirror: { min: 0, max: 100, description: "% of replies made only from the messages of the person I'm answering" },
	dialogue: { min: 0, max: 100, description: "% of replies built from what people answered to similar messages" },
};

let defaults: GuildSettings;
const cache = new Map<string, GuildSettings>();

export function initSettings(cfg: Config) {
	defaults = {
		chance: cfg.chance ?? 20,
		timeout: cfg.timeout ?? 30,
		coherence: cfg.coherence ?? 0.85,
		maxOverlap: cfg.max_overlap ?? 0.7,
		mediaChance: cfg.media_chance ?? 10,
		mirror: cfg.mirror ?? 0,
		dialogue: cfg.dialogue ?? 60,
	};
}

const q = {
	get: db.prepare<[string], string>("SELECT json FROM settings WHERE guild_id = ?").pluck(),
	set: db.prepare(
		"INSERT INTO settings (guild_id, json) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET json = excluded.json",
	),
};

export function getSettings(guildId: string): GuildSettings {
	let settings = cache.get(guildId);
	if (!settings) {
		const stored = q.get.get(guildId);
		settings = { ...defaults, ...(stored ? (JSON.parse(stored) as Partial<GuildSettings>) : {}) };
		cache.set(guildId, settings);
	}
	return settings;
}

export function isSettingKey(key: string): key is SettingKey {
	return key in SETTINGS;
}

export function setSetting(guildId: string, key: SettingKey, value: number): string | null {
	const { min, max } = SETTINGS[key];
	if (!Number.isFinite(value) || value < min || value > max) return `${key} must be a number from ${min} to ${max}`;

	const settings = { ...getSettings(guildId), [key]: value };
	q.set.run(guildId, JSON.stringify(settings));
	cache.set(guildId, settings);
	return null;
}
