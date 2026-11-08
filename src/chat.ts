import { cleanContent, type Message } from "discord.js";
import { client } from "./client.js";
import { historyRunning } from "./collector.js";
import { generateText, hasEnoughFrom, quiet, randomMedia, type Payload } from "./content.js";
import type { ChannelContext } from "./context.js";
import { tokenize } from "./markov.js";
import { resolveEmojis } from "./emoji.js";
import { getSettings } from "./settings.js";
import { signature } from "./text.js";

const NAME_CHANCE_MULTIPLIER = 3;
// Someone talked to the bot this recently: it's a conversation, keep it going
const CONVERSATION_MS = 3 * 60 * 1000;
const CONVERSATION_MULTIPLIER = 2;
const MIN_IGNORED_MULTIPLIER = 0.1;
// Being ignored is forgotten after this long, so a quiet chat doesn't silence the bot forever
const IGNORE_FORGET_MS = 60 * 60 * 1000;
const RECENT_PHRASES = 20;

const timeoutUntil = new Map<string, number>();

interface Engagement {
	lastBotMessage: string | null;
	lastBotAt: number;
	// Someone answered, pinged or reacted after the bot's last message
	answered: boolean;
	// Bot messages in a row that nobody reacted to
	ignoredStreak: number;
	lastEngagedAt: number;
	recent: string[];
}

const engagement = new Map<string, Engagement>();

function stateOf(channelId: string): Engagement {
	let state = engagement.get(channelId);
	if (!state) {
		state = { lastBotMessage: null, lastBotAt: 0, answered: false, ignoredStreak: 0, lastEngagedAt: 0, recent: [] };
		engagement.set(channelId, state);
	}
	return state;
}

export function noteEngagement(channelId: string) {
	const state = stateOf(channelId);
	state.answered = true;
	state.ignoredStreak = 0;
	state.lastEngagedAt = Date.now();
}

export function isLastBotMessage(channelId: string, messageId: string) {
	return engagement.get(channelId)?.lastBotMessage === messageId;
}

// Ignored twice in a row: half the chance, three times: a quarter, and so on.
// Right after someone talked to the bot the chance is doubled.
function chanceMultiplier(channelId: string) {
	const state = stateOf(channelId);
	if (Date.now() - state.lastBotAt > IGNORE_FORGET_MS) state.ignoredStreak = 0;
	let multiplier = Math.max(MIN_IGNORED_MULTIPLIER, 0.5 ** Math.max(0, state.ignoredStreak - 1));
	if (Date.now() - state.lastEngagedAt < CONVERSATION_MS) multiplier *= CONVERSATION_MULTIPLIER;
	return multiplier;
}

function avoidSet(channelId: string) {
	return new Set(stateOf(channelId).recent);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function typingDelay(text: string) {
	return Math.min(4000, 700 + text.length * 35) * (0.8 + Math.random() * 0.4);
}

async function send(message: Message<true>, payload: Payload, asReply: boolean) {
	const original = payload.content;
	if (original) {
		const content = resolveEmojis(original, message.channel);
		if (!content && !payload.files) return;
		payload = { ...payload, content };
	}
	await message.channel.sendTyping().catch(() => {});
	await sleep(typingDelay(payload.content ?? ""));
	const sent = asReply ? await message.reply(payload) : await message.channel.send(payload);

	const state = stateOf(message.channelId);
	if (state.lastBotMessage && !state.answered) state.ignoredStreak++;
	state.lastBotMessage = sent.id;
	state.lastBotAt = Date.now();
	state.answered = false;
	// The generator compares its own phrases, so the text before emoji resolution is remembered
	if (original) {
		state.recent.push(signature(original));
		if (state.recent.length > RECENT_PHRASES) state.recent.shift();
	}
}

// Message text without the bot's ping if the message is addressed to the bot (ping or reply to it), otherwise null
export function getAddress(message: Message<true>): string | null {
	const botId = client.user!.id;
	if (!message.mentions.users.has(botId) && message.mentions.repliedUser?.id !== botId) return null;
	return cleanContent(message.content.replace(new RegExp(`<@!?${botId}>`, "g"), " "), message.channel).trim();
}

function mentionsBotName(message: Message<true>): boolean {
	const content = message.content.toLowerCase();
	const names = [client.user!.username, message.guild.members.me?.displayName]
		.filter((n): n is string => !!n && n.length >= 3)
		.map(n => n.toLowerCase());
	return names.some(n => content.includes(n));
}

// Mirror mode: with mirror% probability the bot answers a person with their own words.
// If the person has too few messages, it replies as usual.
async function mirrorTarget(message: Message<true>, ctx: ChannelContext): Promise<string | undefined> {
	if (Math.random() * 100 >= getSettings(ctx.guildId).mirror) return undefined;
	return (await hasEnoughFrom(ctx, message.author.id)) ? message.author.id : undefined;
}

export async function autoReply(message: Message<true>, ctx: ChannelContext) {
	// The corpus is incomplete while log_history runs, so stay quiet
	if (historyRunning.has(ctx.guildId)) return;
	const settings = getSettings(ctx.guildId);
	if ((timeoutUntil.get(ctx.guildId) ?? 0) > Date.now()) return;
	let chance = settings.chance * chanceMultiplier(ctx.channelId);
	if (mentionsBotName(message)) chance *= NAME_CHANCE_MULTIPLIER;
	if (Math.random() * 100 >= chance) return;
	timeoutUntil.set(ctx.guildId, Date.now() + settings.timeout * 1000);

	if (Math.random() * 100 < settings.mediaChance) {
		const media = await randomMedia(ctx);
		if (media) return send(message, media, false);
	}

	const text = await generateText(ctx, {
		context: message.cleanContent,
		allowSecondSentence: true,
		authorId: await mirrorTarget(message, ctx),
		dialogue: true,
		avoid: avoidSet(ctx.channelId),
	});
	if (text) await send(message, { content: text, ...quiet }, false);
}

export async function directReply(message: Message<true>, ctx: ChannelContext, context: string) {
	noteEngagement(ctx.channelId);
	if (!tokenize(context).length && Math.random() * 100 < getSettings(ctx.guildId).mediaChance) {
		const media = await randomMedia(ctx);
		if (media) return send(message, media, true);
	}
	const text = await generateText(ctx, {
		context,
		allowSecondSentence: true,
		authorId: await mirrorTarget(message, ctx),
		dialogue: true,
		avoid: avoidSet(ctx.channelId),
	});
	if (text) await send(message, { content: text, ...quiet }, true);
}
