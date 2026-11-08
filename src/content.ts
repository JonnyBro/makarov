import { AttachmentBuilder, type MessageCreateOptions } from "discord.js";
import { client } from "./client.js";
import type { ChannelContext } from "./context.js";
import { imagePath } from "./db.js";
import { stripEmojis } from "./emoji.js";
import { genImpact, genLobster } from "./images.js";
import { logError } from "./logger.js";
import { Corpus, getCorpus, type GenerateOptions } from "./markov.js";
import { getSettings } from "./settings.js";
import { deleteAttachmentRow, findReplies, randomAttachmentRow, randomImageHash, randomLinks } from "./storage.js";

export type Payload = Pick<MessageCreateOptions, "content" | "files" | "allowedMentions">;

export const quiet = { allowedMentions: { parse: [], repliedUser: false } } as const;

const SECOND_SENTENCE_CHANCE = 0.15;
// Fewer answers than this to similar messages is too little to build a reply from
const MIN_DIALOGUE_REPLIES = 2;
// Discord: Unknown Channel / Unknown Message, i.e. the message with the file was deleted
const GONE_CODES = new Set([10003, 10008]);

export interface TextRequest {
	// Text the bot is replying to: keywords are taken from it
	context?: string;
	// Beginning of the phrase to continue
	prefix?: string;
	allowSecondSentence?: boolean;
	// Generate only from this person's messages
	authorId?: string;
	// Answer the context the way people answered similar messages (see the dialogue setting)
	dialogue?: boolean;
	// Signatures of recent bot phrases that shouldn't be repeated
	avoid?: Set<string>;
}

// Builds a reply out of what people answered to messages similar to the context. Short answers like "го" or "хз"
// may come out verbatim: maxOverlap 1 only prefers mixed phrases over exact copies.
function dialogueReply(ctx: ChannelContext, req: TextRequest, coherence: number): string | null {
	const replies = findReplies(ctx.guildId, ctx.scope, req.context!, req.authorId ?? null);
	if (replies.length < MIN_DIALOGUE_REPLIES) return null;
	return Corpus.fromChunks(replies).generate({ coherence, maxOverlap: 1, avoid: req.avoid });
}

// With less material than this the bot would just quote the person's messages
export const MIN_AUTHOR_SENTENCES = 20;

export async function hasEnoughFrom(ctx: ChannelContext, authorId: string) {
	return (await getCorpus(ctx.guildId, ctx.scope, authorId)).sentences >= MIN_AUTHOR_SENTENCES;
}

export async function generateText(ctx: ChannelContext, req: TextRequest = {}): Promise<string | null> {
	const settings = getSettings(ctx.guildId);
	try {
		if (req.context && req.dialogue && Math.random() * 100 < settings.dialogue) {
			const answer = dialogueReply(ctx, req, settings.coherence);
			if (answer) return answer;
		}

		const corpus = await getCorpus(ctx.guildId, ctx.scope, req.authorId);
		const opts: GenerateOptions = {
			coherence: settings.coherence,
			maxOverlap: settings.maxOverlap,
			seeds: req.context ? corpus.pickKeywords(req.context) : undefined,
			avoid: req.avoid,
		};
		const first = corpus.generate({ ...opts, prefix: req.prefix });
		if (!first || !req.allowSecondSentence || Math.random() >= SECOND_SENTENCE_CHANCE) return first;
		const second = corpus.generate(opts);
		return second && second !== first ? `${first}\n${second}` : first;
	} catch (e) {
		logError("text generation failed", e);
		return null;
	}
}

export function randomImage(ctx: ChannelContext): string | null {
	const hash = randomImageHash(ctx.guildId, ctx.scope, ctx.nsfw);
	return hash ? imagePath(hash) : null;
}

export async function randomUrl(ctx: ChannelContext): Promise<string | null> {
	for (const url of randomLinks(ctx.guildId, ctx.scope, ctx.nsfw, 10))
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
			await res.body?.cancel();
			if (res.status === 200) return url;
		} catch {
			// dead link, try the next one
		}

	return null;
}

// Regular files aren't downloaded: Discord CDN links expire, so a fresh one is taken from the message itself
export async function randomFile(ctx: ChannelContext): Promise<Payload | null> {
	for (let i = 0; i < 5; i++) {
		const row = randomAttachmentRow(ctx.guildId, ctx.scope, ctx.nsfw);
		if (!row) return null;
		if (row.kind === "image" && row.image_hash) {
			const name = `${row.image_hash.slice(0, 16)}.jpg`;
			return { files: [new AttachmentBuilder(imagePath(row.image_hash), { name })] };
		}
		if (!row.channel_id || !row.message_id || !row.attachment_id) {
			deleteAttachmentRow(row.id);
			continue;
		}

		try {
			const channel = await client.channels.fetch(row.channel_id);
			if (channel?.isTextBased()) {
				const att = (await channel.messages.fetch(row.message_id)).attachments.get(row.attachment_id);
				if (att) return { content: att.url, ...quiet };
			}
			deleteAttachmentRow(row.id);
		} catch (e) {
			if (GONE_CODES.has((e as { code?: number }).code ?? 0)) deleteAttachmentRow(row.id);
		}
	}
	return null;
}

export async function randomMedia(ctx: ChannelContext): Promise<Payload | null> {
	if (Math.random() < 0.5) {
		const url = await randomUrl(ctx);
		return url ? { content: url, ...quiet } : null;
	}
	return randomFile(ctx);
}

export async function makeMeme(
	ctx: ChannelContext,
	kind: "impact" | "lobster",
	context: string,
	authorId?: string,
): Promise<Buffer | null> {
	const image = randomImage(ctx);
	if (!image) return null;
	const caption = async () => stripEmojis((await generateText(ctx, { context, authorId })) ?? "") || null;

	if (kind === "lobster") {
		const text = await caption();
		return text ? genLobster(image, text) : null;
	}

	const top = await caption();
	if (!top) return null;
	const captions: { text: string; gravity: "north" | "south" }[] = [{ text: top, gravity: "north" }];
	if (Math.random() > 0.5) {
		const bottom = await caption();
		if (bottom) captions.push({ text: bottom, gravity: "south" });
	}
	return genImpact(image, captions);
}
