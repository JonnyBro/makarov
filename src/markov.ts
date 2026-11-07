// Порт markovify (Chain + NewlineText), чтобы генерация на старых логах вела себя так же, как в Python-версии.
import fs from "node:fs";

const BEGIN = "___BEGIN__";
const END = "___END__";
const SEP = "\u0000";
const MAX_WALK = 1000;
// markovify.Text.reject_pat: выкидывает строки с кавычками, скобками и "висящими" апострофами
const REJECT = /(^')|('$)|\s'|'\s|["()[\]]/;

interface StateEntry {
	counts: Map<string, number>;
	words?: string[];
	cumdist?: number[];
}

function choiceIndex(cumdist: number[]): number {
	const r = Math.random() * cumdist[cumdist.length - 1];
	let lo = 0;
	let hi = cumdist.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cumdist[mid] > r) hi = mid;
		else lo = mid + 1;
	}
	return lo;
}

// Python round() — банковское округление, от него зависит длина проверяемых n-грамм
function pyRound(x: number): number {
	const r = Math.round(x);
	return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function shuffle<T>(arr: T[]): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

class Chain {
	readonly model = new Map<string, StateEntry>();

	constructor(readonly stateSize: number) {}

	addRun(run: string[]) {
		const items: string[] = [...Array<string>(this.stateSize).fill(BEGIN), ...run, END];
		for (let i = 0; i <= run.length; i++) {
			const state = items.slice(i, i + this.stateSize).join(SEP);
			const follow = items[i + this.stateSize];
			let entry = this.model.get(state);
			if (!entry) {
				entry = { counts: new Map() };
				this.model.set(state, entry);
			}
			entry.counts.set(follow, (entry.counts.get(follow) ?? 0) + 1);
			entry.words = undefined;
			entry.cumdist = undefined;
		}
	}

	private move(state: string): string | null {
		const entry = this.model.get(state);
		if (!entry) return null;
		if (!entry.words || !entry.cumdist) {
			entry.words = [];
			entry.cumdist = [];
			let acc = 0;
			for (const [word, count] of entry.counts) {
				acc += count;
				entry.words.push(word);
				entry.cumdist.push(acc);
			}
		}
		return entry.words[choiceIndex(entry.cumdist)];
	}

	walk(initState?: string[]): string[] | null {
		let state = initState ?? Array<string>(this.stateSize).fill(BEGIN);
		const out: string[] = [];
		while (out.length < MAX_WALK) {
			const next = this.move(state.join(SEP));
			if (next === null) return null;
			if (next === END) break;
			out.push(next);
			state = [...state.slice(1), next];
		}
		return out;
	}
}

export interface SentenceOptions {
	maxOverlapRatio?: number;
	maxOverlapTotal?: number;
	testOutput?: boolean;
	tries?: number;
}

export class TextModel {
	readonly chain: Chain;
	private rejoined = "";

	constructor(readonly stateSize: number) {
		this.chain = new Chain(stateSize);
	}

	addText(text: string) {
		const accepted: string[] = [];
		for (const sentence of text.split(/\s*\n\s*/)) {
			if (!sentence.trim() || REJECT.test(sentence)) continue;
			const words = sentence.split(/\s+/);
			this.chain.addRun(words);
			accepted.push(words.join(" "));
		}
		if (!accepted.length) return;
		this.rejoined = this.rejoined ? `${this.rejoined}\n${accepted.join("\n")}` : accepted.join("\n");
	}

	private testSentenceOutput(words: string[], maxOverlapRatio: number, maxOverlapTotal: number): boolean {
		const overlapMax = Math.min(maxOverlapTotal, pyRound(maxOverlapRatio * words.length));
		const overlapOver = overlapMax + 1;
		const gramCount = Math.max(words.length - overlapMax, 1);
		for (let i = 0; i < gramCount; i++)
			if (this.rejoined.includes(words.slice(i, i + overlapOver).join(" "))) return false;

		return true;
	}

	makeSentence(initState?: string[], opts: SentenceOptions = {}): string | null {
		const { maxOverlapRatio = 0.7, maxOverlapTotal = 15, testOutput = true, tries = 10 } = opts;
		const prefix = initState?.filter(w => w !== BEGIN) ?? [];

		for (let i = 0; i < (testOutput ? tries : 1); i++) {
			const walked = this.chain.walk(initState);
			if (walked === null) return null;
			const words = [...prefix, ...walked];
			if (!testOutput || this.testSentenceOutput(words, maxOverlapRatio, maxOverlapTotal)) return words.join(" ");
		}
		return null;
	}

	makeSentenceWithStart(beginning: string, strict = true, opts: SentenceOptions = {}): string | null {
		const split = beginning.trim().split(/\s+/).filter(Boolean);
		const wordCount = split.length;
		let initStates: string[][];

		if (wordCount === this.stateSize) initStates = [split];
		else if (wordCount > 0 && wordCount < this.stateSize)
			if (strict) initStates = [[...Array<string>(this.stateSize - wordCount).fill(BEGIN), ...split]];
			else {
				initStates = [];
				for (const key of this.chain.model.keys()) {
					const state = key.split(SEP);
					const meaningful = state.filter(w => w !== BEGIN).slice(0, wordCount);
					if (meaningful.length === wordCount && meaningful.every((w, i) => w === split[i]))
						initStates.push(state);
				}
				shuffle(initStates);
			}
		else return null;

		for (const state of initStates) {
			const out = this.makeSentence(state, opts);
			if (out !== null) return out;
		}
		return null;
	}
}

interface CacheEntry {
	model: TextModel;
	size: number;
	mtimeMs: number;
	endsWithNewline: boolean;
}

const CACHE_LIMIT = 8;
const cache = new Map<string, CacheEntry>();

function decode(buf: Buffer): string {
	// Python читал с errors="ignore" — битые байты просто выкидываем
	return buf.toString("utf-8").replaceAll("\uFFFD", "");
}

// Логи только дописываются в конец, поэтому модель не строится заново на каждый запрос,
// а дочитывает новые строки. Полная пересборка — при смене randomness или если файл изменился иначе.
export function getModel(file: string, stateSize: number): TextModel {
	const stat = fs.statSync(file);
	let entry = cache.get(file);

	const canAppend = entry && entry.model.stateSize === stateSize && entry.endsWithNewline && stat.size >= entry.size;

	if (entry && canAppend) {
		if (stat.size > entry.size) {
			const fd = fs.openSync(file, "r");
			try {
				const buf = Buffer.alloc(stat.size - entry.size);
				fs.readSync(fd, buf, 0, buf.length, entry.size);
				entry.model.addText(decode(buf));
				entry.endsWithNewline = buf[buf.length - 1] === 0x0a;
			} finally {
				fs.closeSync(fd);
			}
			entry.size = stat.size;
			entry.mtimeMs = stat.mtimeMs;
		}
	} else {
		const buf = fs.readFileSync(file);
		const model = new TextModel(stateSize);
		model.addText(decode(buf));
		entry = { model, size: buf.length, mtimeMs: stat.mtimeMs, endsWithNewline: buf[buf.length - 1] === 0x0a };
	}

	cache.delete(file);
	cache.set(file, entry);
	while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);

	return entry.model;
}
