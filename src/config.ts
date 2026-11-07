import fs from "node:fs";
import path from "node:path";

// Данные лежат там же, где их держала Python-версия: makarov/{configs,internal,logs}
export const DATA_DIR = path.resolve(process.env.MAKAROV_DIR ?? path.join(import.meta.dirname, "..", "makarov"));
export const CONFIGS_DIR = path.join(DATA_DIR, "configs");
export const INTERNAL_DIR = path.join(DATA_DIR, "internal");
export const LOGS_DIR = path.join(DATA_DIR, "logs");

export interface Config {
	token: string;
	custom_status: boolean;
	timeout: number;
	chance: number;
	randomness: number;
	max_overlap: number;
}

export function loadConfig(): Config {
	const file = path.join(CONFIGS_DIR, process.env.MAKAROV_CONFIG ?? "1.json");
	return JSON.parse(fs.readFileSync(file, "utf-8")) as Config;
}
