import { Worker } from "node:worker_threads";
import { Corpus, type CorpusState } from "./corpus.js";
import { DB_PATH } from "./db.js";
import { logError } from "./logger.js";
import { rowsSince } from "./storage.js";

export { Corpus, normalize, tokenize, type GenerateOptions } from "./corpus.js";

interface CacheEntry {
	corpus: Corpus;
	lastId: number;
	staleSince: number | null;
}

interface Built {
	corpus: Corpus;
	lastId: number;
}

// Per-author corpora are small and live in their own cache so they don't evict big channel corpora
const caches = {
	scope: { map: new Map<string, CacheEntry>(), limit: 8 },
	author: { map: new Map<string, CacheEntry>(), limit: 16 },
};
// After a message is deleted or edited the corpus is rebuilt at most once every 10 minutes, not immediately
const STALE_REBUILD_MS = 10 * 60 * 1000;
const pending = new Map<string, Promise<CacheEntry>>();
const invalidatedAt = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();

// Under tsx (pnpm dev) the .ts sources run, after a build it's .js
const workerUrl = new URL(`./corpus-worker${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`, import.meta.url);

function* contents(rows: Iterable<{ id: number; content: string }>, state: { lastId: number }) {
	for (const row of rows) {
		state.lastId = row.id;
		yield row.content;
	}
}

// Big corpora are built in a worker so the bot doesn't freeze for seconds. Builds run one at a time:
// each holds the whole corpus in memory, two huge ones at once may not fit.
function buildInWorker(guildId: string, scope: string): Promise<Built> {
	const run = () =>
		new Promise<Built>((resolve, reject) => {
			const worker = new Worker(workerUrl, { workerData: { dbPath: DB_PATH, guildId, scope } });
			worker.once("message", ({ state, lastId }: { state: CorpusState; lastId: number }) =>
				resolve({ corpus: Corpus.fromState(state), lastId }),
			);
			worker.once("error", reject);
			worker.once("exit", code => code !== 0 && reject(new Error(`corpus worker exited with code ${code}`)));
		});
	const job = queue.then(run, run);
	queue = job.catch(() => {});
	return job;
}

function buildHere(guildId: string, scope: string, authorId: string): Built {
	const state = { lastId: 0 };
	const corpus = Corpus.fromChunks(contents(rowsSince(guildId, scope, 0, authorId), state));
	return { corpus, lastId: state.lastId };
}

function remember(cache: (typeof caches)["scope"], key: string, entry: CacheEntry) {
	cache.map.delete(key);
	cache.map.set(key, entry);
	while (cache.map.size > cache.limit) cache.map.delete(cache.map.keys().next().value!);
}

function prefixOf(guildId: string, scope: string) {
	return `${guildId}|${scope}|`;
}

function build(key: string, guildId: string, scope: string, authorId?: string): Promise<CacheEntry> {
	let promise = pending.get(key);
	if (promise) return promise;

	const startedAt = Date.now();
	promise = (async () => {
		const built = authorId ? buildHere(guildId, scope, authorId) : await buildInWorker(guildId, scope);
		// If something was deleted from the scope (forget) during the build, mark the corpus stale right away
		const raced = (invalidatedAt.get(prefixOf(guildId, scope)) ?? 0) >= startedAt;
		const entry: CacheEntry = { ...built, staleSince: raced ? 0 : null };
		remember(authorId ? caches.author : caches.scope, key, entry);
		return entry;
	})().finally(() => pending.delete(key));
	pending.set(key, promise);
	return promise;
}

// A corpus is built once, after that only new messages are read from the database.
// With authorId only this person's messages from the same scope are used.
export async function getCorpus(guildId: string, scope: string, authorId?: string): Promise<Corpus> {
	const cache = authorId ? caches.author : caches.scope;
	const key = `${prefixOf(guildId, scope)}${authorId ?? ""}`;
	let entry = cache.map.get(key);

	// A stale corpus keeps answering while a new one is built in the background
	if (entry && entry.staleSince !== null && Date.now() - entry.staleSince > STALE_REBUILD_MS)
		build(key, guildId, scope, authorId).catch(e => logError(`failed to rebuild corpus ${key}`, e));
	entry ??= await build(key, guildId, scope, authorId);

	const fresh = { lastId: entry.lastId };
	for (const content of contents(rowsSince(guildId, scope, entry.lastId, authorId), fresh))
		entry.corpus.addText(content);
	entry.lastId = fresh.lastId;

	if (cache.map.get(key) === entry) remember(cache, key, entry);
	return entry.corpus;
}

export function invalidateCorpus(guildId: string, scope: string, immediate = false) {
	const prefix = prefixOf(guildId, scope);
	if (immediate) invalidatedAt.set(prefix, Date.now());
	for (const { map } of Object.values(caches))
		for (const [key, entry] of map) {
			if (!key.startsWith(prefix)) continue;
			if (immediate) map.delete(key);
			else entry.staleSince ??= Date.now();
		}
}

// Warm-up on startup: the biggest corpora are built in advance so the first reply doesn't wait for a build
export async function warmUp(scopes: { guildId: string; scope: string }[]) {
	for (const { guildId, scope } of scopes.slice(0, caches.scope.limit))
		await getCorpus(guildId, scope).catch(e => logError(`failed to warm up corpus ${guildId}|${scope}`, e));
}
