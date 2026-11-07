import fs from "node:fs";
import path from "node:path";
import { LOGS_DIR } from "./config.js";

fs.mkdirSync(LOGS_DIR, { recursive: true });
const logFile = path.join(LOGS_DIR, `makarov_${Math.round(Date.now() / 1000)}.log`);

export function logError(msg: string, err?: unknown) {
	const details = err instanceof Error ? (err.stack ?? err.message) : err !== undefined ? String(err) : "";
	const line = `[${new Date().toISOString()}] ERROR ${msg}${details ? `:\n\t${details}` : ""}\n`;
	console.error(line.trimEnd());
	try {
		fs.appendFileSync(logFile, line);
	} catch {
		// логгер не должен ронять бота
	}
}

export function logInfo(msg: string) {
	console.log(`[${new Date().toISOString()}] ${msg}`);
}
