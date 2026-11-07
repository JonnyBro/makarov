import fs from "node:fs";
import path from "node:path";
import {
	ActivityType,
	AttachmentBuilder,
	Client,
	GatewayIntentBits,
	type Message,
	type MessageCreateOptions,
	type MessageReplyOptions,
} from "discord.js";
import { CONFIGS_DIR, loadConfig } from "./config.js";
import { genImpact, genLobster } from "./images.js";
import { logError, logInfo } from "./logger.js";
import { getModel, type TextModel } from "./markov.js";
import {
	attachmentPath,
	choice,
	getChannelType,
	getWhitelist,
	guildDir,
	logPath,
	randomAttachment,
	saveWhitelist,
	type ChannelType,
} from "./storage.js";

const cfg = loadConfig();
const NO_RIGHTS = "You have no rights, comrade. Ask an admin to do this command.";
const URL_RE = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()!@:%_+.~#?&/=]*)/;
const LIVE_ATTACHMENT_LIMIT = 1024 * 1024;
const HISTORY_ATTACHMENT_LIMIT = 2 * 1024 * 1024;

const HELP = [
	"I have several commands that you can ping me with:",
	"\t- allow_private - Allow logging a channel that's considered private. " +
		"Will generate text using only private logs and post it only in private channels that have been whitelisted.",
	"\t- allow_common - Allow logging a public channel. " +
		"Will generate text using only public logs and post it only in public channels that have been whitelisted.",
	"\t- allow_channel - Allow logging a certain channel. " +
		"Will generate text using only logs from the specific whitelisted channel and post it only there.",
	"\t- log_history - Log the whole history of this channel (admin only).",
	"\t- impact - Generate impact meme-styled images using the text generation.",
	"\t- lobster - Generate oldschool vk subtitled images using the text generation.",
	"\t- gen - Generate text and prepend input",
	"\t- urlgen - Get a random link from chat history and post it.",
	"\t- attgen - Get a random file from chat history and post it.",
	"Don't input any command to generate server-based text.",
].join("\n");

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const timeoutUntil = new Map<string, number>();

type GuildMessage = Message<true>;

interface ChannelContext {
	guildId: string;
	channelId: string;
	type: ChannelType;
}

function channelContext(message: GuildMessage): ChannelContext | null {
	const type = getChannelType(message.guildId, message.channelId);
	return type ? { guildId: message.guildId, channelId: message.channelId, type } : null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function isAdmin(message: GuildMessage) {
	return message.member?.permissions.has("Administrator") ?? false;
}

function textToLogLines(text: string) {
	return text
		.split(". ")
		.map(s => `${s}\n`)
		.join("");
}

async function downloadAttachment(url: string, size: number, limit: number, target: string) {
	if (size > limit) return;
	const res = await fetch(url);
	if (!res.ok) return;
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length <= limit) await fs.promises.writeFile(target, buf);
}

async function collectMessage(message: Message, ctx: ChannelContext, text: string, limit: number) {
	let output = text ? textToLogLines(text) : "";
	for (const att of message.attachments.values())
		if (att.url.startsWith("https://cdn.discordapp.com/"))
			try {
				await downloadAttachment(
					att.url,
					att.size,
					limit,
					attachmentPath(ctx.guildId, ctx.type, ctx.channelId, att.url),
				);
			} catch (e) {
				logError(`failed to download attachment ${att.url}`, e);
			}
		else output += `${att.url}\n`;

	return output;
}

async function logMessage(message: GuildMessage) {
	const ctx = channelContext(message);
	if (!ctx) return;
	await fs.promises.mkdir(guildDir(ctx.guildId), { recursive: true });
	const output = await collectMessage(message, ctx, message.cleanContent, LIVE_ATTACHMENT_LIMIT);
	if (output) await fs.promises.appendFile(logPath(ctx.guildId, ctx.type, ctx.channelId), output);
}

async function logHistory(message: GuildMessage) {
	const ctx = channelContext(message);
	if (!ctx) return;
	await fs.promises.mkdir(guildDir(ctx.guildId), { recursive: true });
	const file = logPath(ctx.guildId, ctx.type, ctx.channelId);

	let before: string | undefined;
	for (;;) {
		const batch = await message.channel.messages.fetch({ limit: 100, before });
		if (!batch.size) break;
		let chunk = "";
		for (const msg of batch.values()) {
			if (msg.author.id === client.user!.id || msg.author.bot) continue;
			chunk += await collectMessage(msg, ctx, msg.content, HISTORY_ATTACHMENT_LIMIT);
		}
		if (chunk) await fs.promises.appendFile(file, chunk);
		before = batch.lastKey();
	}
}

async function whitelistToggle(message: GuildMessage, type: ChannelType) {
	if (!isAdmin(message)) return void (await message.reply(NO_RIGHTS));

	const current = getChannelType(message.guildId, message.channelId);
	if (current && current !== type) {
		await message.reply(
			`Can't have one channel being two different types at the same time! Remove it from **${current}**!`,
		);
		return;
	}

	const whitelist = new Set(getWhitelist(message.guildId, type));
	let reply: string;
	if (whitelist.has(message.channelId)) {
		whitelist.delete(message.channelId);
		reply = `Removed this channel from the **${type}** whitelist. (${message.channelId})`;
	} else {
		whitelist.add(message.channelId);
		reply = `Added this channel to the **${type}** whitelist. (${message.channelId})`;
	}

	try {
		saveWhitelist(message.guildId, type, whitelist);
	} catch (e) {
		logError("Failed to write to the whitelist!", e);
		return;
	}
	await message.reply(reply);
}

function makeSentence(model: TextModel): string | null {
	return (
		model.makeSentence(undefined, { maxOverlapRatio: cfg.max_overlap }) ??
		model.makeSentence(undefined, { maxOverlapRatio: cfg.max_overlap, testOutput: false })
	);
}

function makePrependedSentence(model: TextModel, init: string): string | null {
	const opts = { maxOverlapRatio: cfg.max_overlap };
	const out = model.makeSentenceWithStart(init, true, opts);
	if (out) return out;

	// Не вышло с полным началом — пробуем только с последним словом, потом нестрого, потом просто склеиваем
	const words = init.trim().split(/\s+/);
	const last = words.pop()!;
	const forgotten = words.join(" ");
	const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" ");

	const byLast = model.makeSentenceWithStart(last, true, opts);
	if (byLast) return join(forgotten, byLast);

	const relaxed = model.makeSentenceWithStart(join(forgotten, last), false, opts);
	if (relaxed) return relaxed;

	return join(forgotten, last, makeSentence(model));
}

function generateFromFile(file: string, prepend?: string): string | null {
	try {
		const model = getModel(file, cfg.randomness);
		return prepend ? makePrependedSentence(model, prepend) : makeSentence(model);
	} catch (e) {
		logError(`text generation failed for ${file}`, e);
		return null;
	}
}

function generateMarkovText(message: GuildMessage, prepend?: string): string | null {
	const ctx = channelContext(message);
	if (!ctx) return null;
	return generateFromFile(logPath(ctx.guildId, ctx.type, ctx.channelId), prepend);
}

function getRandomAtt(message: GuildMessage, ext?: string): string | null {
	const ctx = channelContext(message);
	if (!ctx) return null;
	return randomAttachment(ctx.guildId, ctx.type, ctx.channelId, ext);
}

async function randomUrl(message: GuildMessage): Promise<string | null> {
	const ctx = channelContext(message);
	if (!ctx) return null;

	let lines: string[];
	try {
		lines = (await fs.promises.readFile(logPath(ctx.guildId, ctx.type, ctx.channelId), "utf-8")).split("\n");
	} catch {
		return null;
	}
	const urls = lines.filter(l => URL_RE.test(l));
	if (!urls.length) return null;

	for (let i = 0; i < 50; i++) {
		const url = choice(urls).trim();
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
			await res.body?.cancel();
			if (res.status === 200) return url;
		} catch {
			// битая ссылка — пробуем следующую
		}
	}
	return null;
}

async function withTyping<T>(message: GuildMessage, fn: () => Promise<T>): Promise<T> {
	await message.channel.sendTyping().catch(() => {});
	return fn();
}

const quiet = { allowedMentions: { parse: [], repliedUser: false } } as const;

async function markovGeneration(message: GuildMessage, automatic: boolean, prepend?: string) {
	if (automatic) {
		if ((timeoutUntil.get(message.guildId) ?? 0) > Date.now()) return;
		if (Math.random() < 1 - cfg.chance / 100) return;
		timeoutUntil.set(message.guildId, Date.now() + cfg.timeout * 1000);
	}

	let output: string | null;
	let isAtt = false;
	if (!prepend && Math.random() < 0.2)
		if (Math.random() <= 0.5) output = await randomUrl(message);
		else {
			isAtt = true;
			output = getRandomAtt(message);
		}
	else output = generateMarkovText(message, prepend);

	if (!output) return;

	await withTyping(message, async () => {
		await sleep(1000 + Math.random() * 1250);
		const payload: MessageCreateOptions & MessageReplyOptions = isAtt
			? { files: [output] }
			: { content: output, ...quiet };
		if (automatic) await message.channel.send(payload);
		else await message.reply(payload);
	});
}

async function markovImage(message: GuildMessage, kind: "impact" | "lobster") {
	await withTyping(message, async () => {
		const atts = [getRandomAtt(message, "jpg"), getRandomAtt(message, "png")].filter((a): a is string => !!a);
		if (!atts.length) return;
		const image = choice(atts);

		let buf: Buffer;
		if (kind === "impact") {
			const captions: { text: string; gravity: "north" | "south" }[] = [];
			const top = generateMarkovText(message);
			if (!top) return;
			captions.push({ text: top, gravity: "north" });
			if (Math.random() > 0.5) {
				const bottom = generateMarkovText(message);
				if (!bottom) return;
				captions.push({ text: bottom, gravity: "south" });
			}
			buf = await genImpact(image, captions);
		} else {
			const text = generateMarkovText(message);
			if (!text) return;
			buf = await genLobster(image, text);
		}
		await message.reply({
			files: [new AttachmentBuilder(buf, { name: `${Math.round(Date.now() / 1000)}_output.jpg` })],
		});
	});
}

async function setSessionValue(
	message: GuildMessage,
	key: "randomness" | "max_overlap" | "chance",
	raw: string | undefined,
) {
	if (!isAdmin(message)) return void (await message.reply(NO_RIGHTS));
	const value = key === "max_overlap" ? parseFloat(raw ?? "") : parseInt(raw ?? "", 10);
	if (!Number.isFinite(value) || (key === "randomness" && value < 1)) {
		await message.reply(`Usage: ${key} <number>`);
		return;
	}
	cfg[key] = value;
	const label = key === "max_overlap" ? "max overlap" : key;
	await message.reply(
		`Set the ${label} value to ${value}.\n` +
			"It'll be active only for the current bot session. To change it permanently update the config!",
	);
}

async function handleCommand(message: GuildMessage): Promise<boolean> {
	const [, command, ...args] = message.content.trim().split(/\s+/);

	switch (command) {
		case "log_history":
			if (!isAdmin(message)) {
				await message.reply(NO_RIGHTS);
				break;
			}
			await message.reply(
				"Logging the message history... " +
					"(Depending on how much messages there are this might take a really long while.)",
			);
			try {
				await logHistory(message);
			} catch (e) {
				logError("log_history failed", e);
				await message.reply(`Exception occured during the logging process: \`\`\`${e}\`\`\``);
			}
			await message.reply("Logged what we could. Enjoy, lol");
			break;
		case "allow_common":
		case "allow_private":
		case "allow_channel":
			await whitelistToggle(message, command.slice("allow_".length) as ChannelType);
			break;
		case "randomness":
		case "max_overlap":
		case "chance":
			await setSessionValue(message, command, args[0]);
			break;
		case "help":
			await message.reply(`\`\`\`${HELP}\`\`\``);
			break;
		case "impact":
		case "lobster":
			await markovImage(message, command);
			break;
		case "gen":
			await markovGeneration(message, false, args.join(" "));
			break;
		case "attgen": {
			const output = getRandomAtt(message);
			if (output) await message.reply({ files: [output] });
			break;
		}
		case "urlgen": {
			const output = await randomUrl(message);
			if (output) await message.reply(output);
			break;
		}
		default:
			await markovGeneration(message, false);
			return true;
	}
	return false;
}

function updateStatus() {
	try {
		const lines = fs.readFileSync(path.join(CONFIGS_DIR, "status_messages.txt"), "utf-8").trimEnd().split(/\r?\n/);
		const text = choice(lines).replaceAll(".id.", client.user!.username);
		client.user!.setActivity(text, { type: ActivityType.Playing });
	} catch (e) {
		logError("failed to update status", e);
	}
}

client.once("clientReady", c => {
	if (cfg.custom_status) {
		logInfo("Starting custom status task...");
		updateStatus();
		setInterval(updateStatus, 30_000);
	}
	logInfo(`We have logged in as ${c.user.tag}`);
});

client.on("messageCreate", async message => {
	if (!message.inGuild() || message.author.bot || message.author.id === client.user!.id) return;

	try {
		let canLog: boolean;
		if (message.mentions.has(client.user!, { ignoreRoles: true })) canLog = await handleCommand(message);
		else {
			canLog = true;
			await markovGeneration(message, true);
		}
		if (canLog) await logMessage(message);
	} catch (e) {
		logError("error in messageCreate", e);
	}
});

client.on("error", e => logError("client error", e));

client.login(cfg.token);
