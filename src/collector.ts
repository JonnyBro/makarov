import { MessageReferenceType, type Collection, type GuildTextBasedChannel, type Message } from "discord.js";
import { cfg, client } from "./client.js";
import type { ChannelContext } from "./context.js";
import { REPLY_WINDOW_MS } from "./db.js";
import { invalidateCorpus } from "./markov.js";
import { releaseImages, saveAttachment } from "./media.js";
import {
	getHistoryProgress,
	insertLink,
	insertMessage,
	messageExists,
	setHistoryProgress,
	URL_RE,
	type MessageMeta,
	type Removal,
} from "./storage.js";

const QUOTA_BYTES = (cfg.image_quota_mb ?? 500) * 1024 * 1024;

// Guilds where log_history is running: random replies are paused there and a second run won't start
export const historyRunning = new Set<string>();

interface Previous {
	id: string;
	authorId: string;
	at: number;
	bot: boolean;
}

const lastInChannel = new Map<string, Previous>();

function previousOf(message: Message): Previous {
	return { id: message.id, authorId: message.author.id, at: message.createdTimestamp, bot: message.author.bot };
}

// The message this one answers: an explicit reply, otherwise the previous message if someone else sent it
// shortly before. A bot message in between breaks the chain: an answer to the bot isn't an answer to a person.
function replyTarget(message: Message, previous: Previous | undefined): string | null {
	if (message.reference?.messageId && message.reference.type === MessageReferenceType.Default)
		return message.reference.messageId;
	if (!previous || previous.bot || previous.authorId === message.author.id) return null;
	return message.createdTimestamp - previous.at <= REPLY_WINDOW_MS ? previous.id : null;
}

// Must see every message of a channel (bots included) before it is stored; returns what it answers
export function trackChannelMessage(message: Message): string | null {
	const target = replyTarget(message, lastInChannel.get(message.channelId));
	lastInChannel.set(message.channelId, previousOf(message));
	return target;
}

// Sentences are separated by newlines, punctuation stays at the end of the sentence
export function toSentences(text: string) {
	return text
		.split(/(?<=[.!?…])\s+|\n/)
		.map(s => s.trim())
		.filter(Boolean)
		.join("\n");
}

// Returns the number of saved attachments, or -1 if the message wasn't stored (already known or empty)
export async function storeMessage(
	message: Message<true>,
	ctx: ChannelContext,
	text: string,
	replyTo: string | null,
): Promise<number> {
	if (messageExists(message.id)) return -1;
	const content = toSentences(text);
	if (!content && !message.attachments.size) return -1;

	const meta: MessageMeta = {
		messageId: message.id,
		guildId: ctx.guildId,
		scope: ctx.scope,
		channelId: message.channelId,
		authorId: message.author.id,
		createdAt: message.createdTimestamp,
		nsfw: ctx.nsfw,
		replyTo,
	};
	// Empty content is stored too: attachments are later deleted by message_id
	if (!insertMessage(meta, content)) return -1;
	for (const url of text.match(URL_RE) ?? []) insertLink(meta, url);
	for (const att of message.attachments.values())
		await saveAttachment(
			meta,
			{ id: att.id, url: att.url, name: att.name, size: att.size, contentType: att.contentType },
			QUOTA_BYTES,
		);
	return message.attachments.size;
}

export interface HistoryStats {
	messages: number;
	attachments: number;
}

const isOlderOrSame = (a: string, b: string) => BigInt(a) <= BigInt(b);

async function storeBatch(batch: Collection<string, Message<true>>, ctx: ChannelContext, stats: HistoryStats) {
	// Newest first, so the previous message of messages[i] is messages[i + 1]
	const messages = [...batch.values()];
	for (const [i, msg] of messages.entries()) {
		if (msg.author.id === client.user!.id || msg.author.bot) continue;
		const previous = messages[i + 1] ? previousOf(messages[i + 1]) : undefined;
		const attachments = await storeMessage(msg, ctx, msg.cleanContent, replyTarget(msg, previous));
		if (attachments < 0) continue;
		stats.messages++;
		stats.attachments += attachments;
	}
}

// First pages down from the newest messages to where the previous run started (filling gaps from when the bot
// was offline), then continues down from the oldest stored message. Progress is saved after every batch,
// so after a restart log_history picks up where it stopped.
export async function logChannelHistory(
	channel: GuildTextBasedChannel,
	ctx: ChannelContext,
	stats: HistoryStats,
	onBatch: () => void,
) {
	const progress = getHistoryProgress(channel.id);
	const previousNewest = progress.newestId;
	let before: string | undefined;

	for (;;) {
		const batch = await channel.messages.fetch({ limit: 100, before, cache: false });
		if (!batch.size) {
			if (!previousNewest) progress.done = true;
			break;
		}
		if (!before) progress.newestId = batch.firstKey()!;
		await storeBatch(batch, ctx, stats);
		before = batch.lastKey()!;
		if (!previousNewest) progress.oldestId = before;
		setHistoryProgress(channel.id, progress);
		onBatch();
		if (previousNewest && isOlderOrSame(before, previousNewest)) break;
	}

	before = progress.oldestId ?? undefined;
	while (!progress.done) {
		const batch = await channel.messages.fetch({ limit: 100, before, cache: false });
		if (!batch.size) progress.done = true;
		else {
			await storeBatch(batch, ctx, stats);
			before = progress.oldestId = batch.lastKey()!;
			onBatch();
		}
		setHistoryProgress(channel.id, progress);
	}
}

export function applyRemoval(removal: Removal, immediate = false) {
	for (const { guildId, scope } of removal.scopes) invalidateCorpus(guildId, scope, immediate);
	releaseImages(removal.imageHashes);
}
