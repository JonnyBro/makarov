// The corpus is flat arrays of token ids, sentences are wrapped in BEGIN/END.
// The next word is a random occurrence of the context in the corpus: this automatically
// weights by frequency, and the same index works for generating both forwards and backwards.
const BEGIN = 0;
const END = 1;
const PAIR = 2 ** 26;
const MAX_TOKENS = 50;
const URL_ONLY = /^https?:\/\/\S+$/;
const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const HAS_LETTER = /\p{L}/u;

export function normalize(token: string): string {
	const lower = token.toLowerCase().replaceAll("ё", "е");
	return lower.replace(EDGE_PUNCT, "") || lower;
}

export function tokenize(text: string): string[] {
	return text.trim().split(/\s+/).filter(Boolean);
}

function randInt(n: number) {
	return Math.floor(Math.random() * n);
}

class IntList {
	data = new Int32Array(1024);
	length = 0;

	static from(data: Int32Array): IntList {
		return Object.assign(new IntList(), { data, length: data.length });
	}

	push(v: number) {
		if (this.length === this.data.length) {
			const next = new Int32Array(this.data.length * 2);
			next.set(this.data);
			this.data = next;
		}
		this.data[this.length++] = v;
	}
}

// Occurrence positions of every context: contexts are sorted in a Float64Array (binary search), positions are
// stored contiguously in one Int32Array. Everything is typed arrays so a built index can be transferred
// from a worker without copying.
// New messages accumulate in delta and are merged on the next rebuild.
export interface IndexState {
	ctx: Float64Array;
	starts: Int32Array;
	lens: Int32Array;
	sorted: Int32Array;
}

class OccurrenceIndex {
	private ctx = new Float64Array(0);
	private starts = new Int32Array(0);
	private lens = new Int32Array(0);
	private sorted = new Int32Array(0);
	private delta = new Map<number, number[]>();
	deltaSize = 0;

	add(ctx: number, pos: number) {
		let list = this.delta.get(ctx);
		if (!list) {
			list = [];
			this.delta.set(ctx, list);
		}
		list.push(pos);
		this.deltaSize++;
	}

	private find(ctx: number): number {
		let lo = 0;
		let hi = this.ctx.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const v = this.ctx[mid];
			if (v === ctx) return mid;
			if (v < ctx) lo = mid + 1;
			else hi = mid - 1;
		}
		return -1;
	}

	sample(ctx: number): number {
		const e = this.find(ctx);
		const baseLen = e < 0 ? 0 : this.lens[e];
		const extra = this.delta.get(ctx);
		const total = baseLen + (extra?.length ?? 0);
		if (!total) return -1;
		const r = randInt(total);
		return r < baseLen ? this.sorted[this.starts[e] + r] : extra![r - baseLen];
	}

	rebuild(length: number, ctxAt: (i: number) => number) {
		const ranks = new Map<number, number>();
		for (let i = 0; i < length; i++) {
			const c = ctxAt(i);
			if (c >= 0 && !ranks.has(c)) ranks.set(c, 0);
		}
		const ctx = Float64Array.from(ranks.keys()).sort();
		for (let r = 0; r < ctx.length; r++) ranks.set(ctx[r], r);

		const lens = new Int32Array(ctx.length);
		const entryOf = new Int32Array(length).fill(-1);
		let total = 0;
		for (let i = 0; i < length; i++) {
			const c = ctxAt(i);
			if (c < 0) continue;
			const r = ranks.get(c)!;
			lens[r]++;
			entryOf[i] = r;
			total++;
		}

		const starts = new Int32Array(ctx.length);
		for (let r = 1; r < ctx.length; r++) starts[r] = starts[r - 1] + lens[r - 1];
		const fill = starts.slice();
		const sorted = new Int32Array(total);
		for (let i = 0; i < length; i++) if (entryOf[i] >= 0) sorted[fill[entryOf[i]]++] = i;

		Object.assign(this, { ctx, starts, lens, sorted });
		this.delta.clear();
		this.deltaSize = 0;
	}

	toState(): IndexState {
		return { ctx: this.ctx, starts: this.starts, lens: this.lens, sorted: this.sorted };
	}

	static fromState(state: IndexState): OccurrenceIndex {
		return Object.assign(new OccurrenceIndex(), state);
	}
}

interface Token {
	key: number;
	surface: string;
}

export interface GenerateOptions {
	// Normalized keywords the phrase is built around
	seeds?: string[];
	// Beginning of the phrase to continue (as typed by the user)
	prefix?: string;
	// Probability of using two words of context instead of one
	coherence?: number;
	// Share of the phrase that may be copied verbatim from a single message
	maxOverlap?: number;
	candidates?: number;
}

export interface CorpusState {
	keyStr: string[];
	surfStr: string[];
	freq: Int32Array;
	keys: Int32Array;
	surfs: Int32Array;
	uni: IndexState;
	bi: IndexState;
	copyText: string;
	sentences: number;
	tokens: number;
}

export class Corpus {
	private keyIds = new Map<string, number>();
	private keyStr: string[] = ["\u0002BEGIN", "\u0002END"];
	// Built lazily after a transfer from a worker: only needed when adding new messages
	private surfIds: Map<string, number> | null = new Map();
	private surfStr: string[] = ["", ""];
	private keys = new IntList();
	private surfs = new IntList();
	private freq: number[] = [0, 0];
	private uni = new OccurrenceIndex();
	private bi = new OccurrenceIndex();
	// Normalized corpus text for the verbatim copy check: "\n k1 k2 k3 \n k1 ... \n"
	private copyParts: string[] = ["\n"];
	private copyText: string | null = null;
	private bulk = false;
	sentences = 0;
	tokens = 0;

	private keyId(key: string): number {
		let id = this.keyIds.get(key);
		if (id === undefined) {
			id = this.keyStr.length;
			this.keyIds.set(key, id);
			this.keyStr.push(key);
			this.freq.push(0);
		}
		return id;
	}

	private surfId(surface: string): number {
		this.surfIds ??= new Map(this.surfStr.map((s, i) => [s, i]));
		let id = this.surfIds.get(surface);
		if (id === undefined) {
			id = this.surfStr.length;
			this.surfIds.set(surface, id);
			this.surfStr.push(surface);
		}
		return id;
	}

	private push(key: number, surf: number) {
		this.keys.push(key);
		this.surfs.push(surf);
	}

	addText(text: string) {
		for (const line of text.split("\n")) this.addLine(line);
		if (!this.bulk && this.uni.deltaSize > Math.max(20_000, this.keys.length * 0.1)) this.rebuild();
	}

	private addLine(line: string) {
		const words = tokenize(line);
		if (!words.length || (words.length === 1 && URL_ONLY.test(words[0]))) return;

		const start = this.keys.length;
		this.push(BEGIN, 0);
		const lineKeys: string[] = [];
		for (const word of words) {
			const key = normalize(word);
			const id = this.keyId(key);
			this.freq[id]++;
			lineKeys.push(key);
			this.push(id, this.surfId(word));
		}
		this.push(END, 1);
		this.sentences++;
		this.tokens += words.length;
		this.copyParts.push(` ${lineKeys.join(" ")} \n`);
		this.copyText = null;

		if (this.bulk) return;
		const k = this.keys.data;
		for (let i = start; i < this.keys.length; i++) {
			this.uni.add(k[i], i);
			if (i + 1 < this.keys.length) this.bi.add(k[i] * PAIR + k[i + 1], i);
		}
	}

	private rebuild() {
		const k = this.keys.data;
		const len = this.keys.length;
		this.uni.rebuild(len, i => k[i]);
		this.bi.rebuild(len, i => (i + 1 < len && k[i] !== END ? k[i] * PAIR + k[i + 1] : -1));
	}

	static fromChunks(chunks: Iterable<string>): Corpus {
		const corpus = new Corpus();
		corpus.bulk = true;
		for (const chunk of chunks) corpus.addText(chunk);
		corpus.bulk = false;
		corpus.rebuild();
		return corpus;
	}

	static fromText(text: string): Corpus {
		return Corpus.fromChunks([text]);
	}

	toState(): CorpusState {
		return {
			keyStr: this.keyStr,
			surfStr: this.surfStr,
			freq: Int32Array.from(this.freq),
			keys: this.keys.data.slice(0, this.keys.length),
			surfs: this.surfs.data.slice(0, this.surfs.length),
			uni: this.uni.toState(),
			bi: this.bi.toState(),
			copyText: this.copyCorpus(),
			sentences: this.sentences,
			tokens: this.tokens,
		};
	}

	static transferList(state: CorpusState): ArrayBuffer[] {
		const arrays = [state.freq, state.keys, state.surfs, ...Object.values(state.uni), ...Object.values(state.bi)];
		return [...new Set(arrays.map(a => a.buffer as ArrayBuffer))];
	}

	static fromState(state: CorpusState): Corpus {
		const corpus = new Corpus();
		corpus.keyStr = state.keyStr;
		corpus.keyIds = new Map(state.keyStr.map((k, i) => [k, i]));
		corpus.surfStr = state.surfStr;
		corpus.surfIds = null;
		corpus.freq = Array.from(state.freq);
		corpus.keys = IntList.from(state.keys);
		corpus.surfs = IntList.from(state.surfs);
		corpus.uni = OccurrenceIndex.fromState(state.uni);
		corpus.bi = OccurrenceIndex.fromState(state.bi);
		corpus.copyParts = [state.copyText];
		corpus.copyText = state.copyText;
		corpus.sentences = state.sentences;
		corpus.tokens = state.tokens;
		return corpus;
	}

	frequency(key: string): number {
		const id = this.keyIds.get(key);
		return id === undefined ? 0 : this.freq[id];
	}

	// Keywords of a message: its rarest words that occur in the corpus at least twice
	pickKeywords(text: string, max = 3): string[] {
		const stopFreq = Math.max(this.tokens * 0.003, 5);
		const keys = new Set(tokenize(text).map(normalize));
		return [...keys]
			.filter(k => k.length >= 3 && HAS_LETTER.test(k))
			.map(k => ({ k, f: this.frequency(k) }))
			.filter(({ f }) => f >= 2 && f <= stopFreq)
			.sort((a, b) => a.f - b.f)
			.slice(0, max)
			.map(({ k }) => k);
	}

	private token(pos: number): Token {
		return { key: this.keys.data[pos], surface: this.surfStr[this.surfs.data[pos]] };
	}

	// Returns the corpus position of the next (dir=1) or previous (dir=-1) token
	private step(near: number, far: number | null, dir: 1 | -1, coherence: number): number {
		if (far !== null && Math.random() < coherence) {
			const ctx = dir === 1 ? far * PAIR + near : near * PAIR + far;
			const p = this.bi.sample(ctx);
			if (p >= 0) return dir === 1 ? p + 2 : p - 1;
		}
		const p = this.uni.sample(near);
		return p < 0 ? -1 : p + dir;
	}

	private walk(near: number, far: number | null, dir: 1 | -1, coherence: number): Token[] | null {
		const out: Token[] = [];
		for (;;) {
			const pos = this.step(near, far, dir, coherence);
			if (pos < 0) return out;
			const tok = this.token(pos);
			if (tok.key === BEGIN || tok.key === END) return out;
			if (out.length >= MAX_TOKENS) return null;
			out.push(tok);
			far = near;
			near = tok.key;
		}
	}

	private candidate(seed: number | null, prefix: Token[], coherence: number): Token[] | null {
		if (prefix.length) {
			const last = prefix[prefix.length - 1].key;
			const beforeLast = prefix.length > 1 ? prefix[prefix.length - 2].key : BEGIN;
			if (last < 0) return this.walk(BEGIN, null, 1, coherence);
			return this.walk(last, beforeLast < 0 ? null : beforeLast, 1, coherence);
		}

		if (seed === null) return this.walk(BEGIN, null, 1, coherence);

		const pos = this.uni.sample(seed);
		if (pos < 0) return null;
		const center = this.token(pos);
		const left = this.walk(seed, null, -1, coherence);
		if (!left) return null;
		left.reverse();
		const right = this.walk(seed, left.length ? left[left.length - 1].key : BEGIN, 1, coherence);
		if (!right) return null;
		return [...left, center, ...right];
	}

	private copyCorpus(): string {
		if (this.copyText === null) {
			this.copyText = this.copyParts.join("");
			this.copyParts = [this.copyText];
		}
		return this.copyText;
	}

	private isExactCopy(keys: string[]): boolean {
		return this.copyCorpus().includes(`\n ${keys.join(" ")} \n`);
	}

	private overlapsTooMuch(keys: string[], maxOverlap: number): boolean {
		const text = this.copyCorpus();
		const window = Math.min(15, Math.round(maxOverlap * keys.length)) + 1;
		if (window > keys.length) return this.isExactCopy(keys);
		for (let i = 0; i + window <= keys.length; i++)
			if (text.includes(` ${keys.slice(i, i + window).join(" ")} `)) return true;
		return false;
	}

	private score(tokens: Token[], seeds: Set<number>): number {
		const n = tokens.length;
		const distinct = new Set(tokens.map(t => t.key));
		let s = Math.random() * 1.5;
		if (n < 2) s -= 4;
		else if (n < 4) s -= 1;
		if (n > 25) s -= (n - 25) * 0.3;
		s -= (1 - distinct.size / n) * 6;
		for (const seed of seeds) if (distinct.has(seed)) s += 3;
		return s;
	}

	generate(opts: GenerateOptions = {}): string | null {
		const { coherence = 0.85, maxOverlap = 0.7, candidates = 24 } = opts;
		const seedIds = (opts.seeds ?? [])
			.map(s => this.keyIds.get(s))
			.filter((id): id is number => id !== undefined && this.freq[id] > 0);
		const seedSet = new Set(seedIds);
		const prefixWords = opts.prefix ? tokenize(opts.prefix) : [];
		const prefix: Token[] = prefixWords.map(w => ({ key: this.keyIds.get(normalize(w)) ?? -1, surface: w }));

		let fallback: Token[] | null = null;
		let copyFallback: Token[] | null = null;
		let copies = 0;
		// If everything was a copy at high coherence, the second pass "jumps" between messages more often
		for (const c of [coherence, Math.min(coherence, 0.4)]) {
			const pool: { tokens: Token[]; score: number }[] = [];
			for (let i = 0; i < candidates; i++) {
				const seed = seedIds.length && Math.random() < 0.8 ? seedIds[randInt(seedIds.length)] : null;
				const tokens = this.candidate(seed, prefix, c);
				if (tokens && (tokens.length || prefix.length))
					pool.push({ tokens, score: this.score(tokens, seedSet) });
			}
			pool.sort((a, b) => b.score - a.score);

			for (const { tokens } of pool) {
				const keys = tokens.map(t => this.keyStr[t.key]);
				if (!this.overlapsTooMuch(keys, maxOverlap)) return this.render(prefix, tokens);
				if (!fallback && !this.isExactCopy(keys)) fallback = tokens;
				if (Math.random() < 1 / ++copies) copyFallback = tokens;
			}
		}
		// A small corpus (new channel) has nothing to mix, so repeating a message is better than staying silent
		const best = fallback ?? copyFallback;
		return best ? this.render(prefix, best) : null;
	}

	private render(prefix: Token[], tokens: Token[]): string {
		return [...prefix, ...tokens].map(t => t.surface).join(" ");
	}
}
