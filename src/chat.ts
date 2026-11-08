import { cleanContent, type Message } from "discord.js";
import { client } from "./client.js";
import { historyRunning } from "./collector.js";
import { generateText, hasEnoughFrom, quiet, randomMedia, type Payload } from "./content.js";
import type { ChannelContext } from "./context.js";
import { tokenize } from "./markov.js";
import { getSettings } from "./settings.js";

const NAME_CHANCE_MULTIPLIER = 3;
const timeoutUntil = new Map<string, number>();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function typingDelay(text: string) {
	return Math.min(4000, 700 + text.length * 35) * (0.8 + Math.random() * 0.4);
}

async function send(message: Message<true>, payload: Payload, asReply: boolean) {
	await message.channel.sendTyping().catch(() => {});
	await sleep(typingDelay(payload.content ?? ""));
	if (asReply) await message.reply(payload);
	else await message.channel.send(payload);
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
	const chance = mentionsBotName(message) ? settings.chance * NAME_CHANCE_MULTIPLIER : settings.chance;
	if (Math.random() * 100 >= chance) return;
	timeoutUntil.set(ctx.guildId, Date.now() + settings.timeout * 1000);

	if (Math.random() * 100 < settings.mediaChance) {
		const media = await randomMedia(ctx);
		if (media) return send(message, media, false);
	}

	const authorId = await mirrorTarget(message, ctx);
	const text = await generateText(ctx, { context: message.cleanContent, allowSecondSentence: true, authorId });
	if (text) await send(message, { content: text, ...quiet }, false);
}

export async function directReply(message: Message<true>, ctx: ChannelContext, context: string) {
	if (!tokenize(context).length && Math.random() * 100 < getSettings(ctx.guildId).mediaChance) {
		const media = await randomMedia(ctx);
		if (media) return send(message, media, true);
	}
	const authorId = await mirrorTarget(message, ctx);
	const text = await generateText(ctx, { context, allowSecondSentence: true, authorId });
	if (text) await send(message, { content: text, ...quiet }, true);
}
