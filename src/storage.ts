// Формат файлов в internal/<guild_id>/ совпадает с Python-версией, старые данные подхватываются как есть.
import fs from "node:fs";
import path from "node:path";
import { INTERNAL_DIR } from "./config.js";

export const CHANNEL_TYPES = ["channel", "common", "private"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

const whitelists = new Map<string, Set<string>>();

export function guildDir(guildId: string) {
	return path.join(INTERNAL_DIR, guildId);
}

function whitelistPath(guildId: string, type: ChannelType) {
	return path.join(guildDir(guildId), `whitelisted_channels_${type}.makarov`);
}

// ID каналов лежат в JSON как числа больше 2^53, JSON.parse их испортит — читаем как строки
export function getWhitelist(guildId: string, type: ChannelType): Set<string> {
	const key = `${guildId}:${type}`;
	let set = whitelists.get(key);
	if (!set) {
		try {
			set = new Set(fs.readFileSync(whitelistPath(guildId, type), "utf-8").match(/\d+/g) ?? []);
		} catch {
			set = new Set();
		}
		whitelists.set(key, set);
	}
	return set;
}

export function saveWhitelist(guildId: string, type: ChannelType, set: Set<string>) {
	fs.mkdirSync(guildDir(guildId), { recursive: true });
	fs.writeFileSync(whitelistPath(guildId, type), `[${[...set].join(", ")}]`);
	whitelists.set(`${guildId}:${type}`, set);
}

export function getChannelType(guildId: string, channelId: string): ChannelType | null {
	return CHANNEL_TYPES.find(type => getWhitelist(guildId, type).has(channelId)) ?? null;
}

export function logPath(guildId: string, type: ChannelType, channelId: string) {
	const name = type === "channel" ? `${channelId}_msg_logs.makarov` : `${type}_msg_logs.makarov`;
	return path.join(guildDir(guildId), name);
}

export function attachmentPrefix(type: ChannelType, channelId: string) {
	return type === "channel" ? `${channelId}_attachment_` : `${type}_attachment_`;
}

export function attachmentPath(guildId: string, type: ChannelType, channelId: string, url: string) {
	const name = path.basename(url.split("#")[0].split("?")[0]);
	return path.join(guildDir(guildId), `${attachmentPrefix(type, channelId)}${Date.now() / 1000}_${name}`);
}

export function randomAttachment(guildId: string, type: ChannelType, channelId: string, ext?: string): string | null {
	const dir = guildDir(guildId);
	const prefix = attachmentPrefix(type, channelId);
	let files: string[];
	try {
		files = fs
			.readdirSync(dir, { withFileTypes: true })
			.filter(f => f.isFile() && f.name.startsWith(prefix) && (!ext || f.name.endsWith(ext)))
			.map(f => path.join(dir, f.name));
	} catch {
		return null;
	}
	return files.length ? choice(files) : null;
}

export function choice<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}
