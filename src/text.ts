const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const WORD = /^[\p{L}\p{N}]+$/u;
const CYRILLIC = /[а-я]/;

export function normalize(token: string): string {
	const lower = token.toLowerCase().replaceAll("ё", "е");
	return lower.replace(EDGE_PUNCT, "") || lower;
}

export function tokenize(text: string): string[] {
	return text.trim().split(/\s+/).filter(Boolean);
}

// Prepositions, conjunctions and particles: a phrase ending with one of them looks cut off,
// and they are useless as search terms
export const FUNCTION_WORDS = new Set(
	(
		"и а но или либо да же ли ни не бы в во на с со к ко по о об обо от до из у за над под при про для без " +
		"через между перед около вокруг что чтобы как если когда где куда откуда который которая которые " +
		"чем потому поэтому зато тоже также то ну вот это этот эта эти так ещё еще уже типа " +
		"the a an and or but to of in on at for with from by as that if than so"
	).split(" "),
);

// Fine at the end of a phrase, but say nothing about the topic
const PRONOUNS = new Set(
	(
		"я ты он она оно мы вы они мне меня мной тебя тебе тобой его ему им ее её ей их нас нам вас вам " +
		"там тут здесь все всё весь вся свой своя мой моя твой i you he she it we they me my your"
	).split(" "),
);

// Snowball stemmer for Russian (https://snowballstem.org/algorithms/russian/stemmer.html).
// Groups that require a preceding "а"/"я" use a lookbehind, so the letter stays in the stem.
const PERFECTIVE_GERUND = /((ив|ивши|ившись|ыв|ывши|ывшись)|((?<=[ая])(в|вши|вшись)))$/;
const REFLEXIVE = /(с[яь])$/;
const ADJECTIVE = /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
const PARTICIPLE = /((ивш|ывш|ующ)|((?<=[ая])(ем|нн|вш|ющ|щ)))$/;
const VERB =
	/((ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)|((?<=[ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)))$/;
const NOUN =
	/(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
const RV = /^(.*?[аеиоуыэюя])(.*)$/;
const DERIVATIONAL_R2 = /[аеиоуыэюя][^аеиоуыэюя].*[аеиоуыэюя][^аеиоуыэюя].*ость?$/;

function stemRussian(word: string): string {
	const match = RV.exec(word);
	if (!match || !match[2]) return word;
	const head = match[1];
	let rv = match[2];

	let next = rv.replace(PERFECTIVE_GERUND, "");
	if (next === rv) {
		rv = rv.replace(REFLEXIVE, "");
		next = rv.replace(ADJECTIVE, "");
		if (next !== rv) rv = next.replace(PARTICIPLE, "");
		else {
			next = rv.replace(VERB, "");
			rv = next === rv ? rv.replace(NOUN, "") : next;
		}
	} else rv = next;

	rv = rv.replace(/и$/, "");
	if (DERIVATIONAL_R2.test(head + rv)) rv = rv.replace(/ость?$/, "");

	next = rv.replace(/ь$/, "");
	if (next === rv) rv = rv.replace(/ейше?$/, "").replace(/нн$/, "н");
	else rv = next;

	return head + rv;
}

// Takes a normalized word; only Cyrillic words are stemmed
export function stem(word: string): string {
	return CYRILLIC.test(word) && WORD.test(word) ? stemRussian(word) : word;
}

// A normalized word that can carry the topic of a message
export function isTopicWord(key: string) {
	return WORD.test(key) && /\p{L}/u.test(key) && !FUNCTION_WORDS.has(key) && !PRONOUNS.has(key);
}

// Content-word stems of a text, for full-text search
export function searchStems(text: string): string[] {
	const stems = new Set<string>();
	for (const token of tokenize(text)) {
		const key = normalize(token);
		if (isTopicWord(key)) stems.add(stem(key));
	}
	return [...stems];
}

// Case- and punctuation-insensitive form of a phrase, to notice repeats
export function signature(text: string) {
	return tokenize(text).map(normalize).join(" ");
}
