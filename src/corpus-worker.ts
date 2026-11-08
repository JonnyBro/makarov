import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { Corpus } from "./corpus.js";

interface Job {
	dbPath: string;
	guildId: string;
	scope: string;
}

const { dbPath, guildId, scope } = workerData as Job;
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db
	.prepare<[string, string], { id: number; content: string }>(
		"SELECT id, content FROM messages WHERE guild_id = ? AND scope = ? ORDER BY id",
	)
	.iterate(guildId, scope);

let lastId = 0;
function* contents() {
	for (const row of rows) {
		lastId = row.id;
		yield row.content;
	}
}

const corpus = Corpus.fromChunks(contents());
db.close();
const state = corpus.toState();
parentPort!.postMessage({ state, lastId }, Corpus.transferList(state));
