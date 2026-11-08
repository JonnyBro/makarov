import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

export const ASSETS_DIR = path.join(ROOT, "assets");
export const DATA_DIR = path.resolve(process.env.MAKAROV_DATA ?? path.join(ROOT, "data"));
export const LOGS_DIR = path.join(DATA_DIR, "logs");
export const CONFIG_PATH = path.resolve(process.env.MAKAROV_CONFIG ?? path.join(ROOT, "config.json"));

export interface Config {
	token: string;
	custom_status: boolean;
	// Status texts, ".id." is replaced with the bot's name
	statuses?: string[];
	timeout: number;
	chance: number;
	max_overlap: number;
	coherence?: number;
	media_chance?: number;
	mirror?: number;
	image_quota_mb?: number;
}

export function loadConfig(): Config {
	return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config;
}
