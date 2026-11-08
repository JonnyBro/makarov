import {
	AttachmentBuilder,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	type GuildTextBasedChannel,
	type Message,
} from "discord.js";
import { client } from "./client.js";
import { applyRemoval, historyRunning, logChannelHistory, type HistoryStats } from "./collector.js";
import { generateText, hasEnoughFrom, makeMeme, MIN_AUTHOR_SENTENCES, randomFile, randomUrl } from "./content.js";
import { contextFor, type ChannelContext } from "./context.js";
import { resolveEmojis } from "./emoji.js";
import { logError } from "./logger.js";
import { getSettings, isSettingKey, setSetting, SETTINGS, type SettingKey } from "./settings.js";
import { forgetAuthor, getChannelType, guildChannels, setChannelType, type ChannelType } from "./storage.js";

type Interaction = ChatInputCommandInteraction<"cached">;

const NO_RIGHTS = "You have no rights, comrade. Ask an admin to do this command.";
const NOT_LOGGED = "This channel isn't logged. An admin can enable it with `/allow`.";
const PROGRESS_INTERVAL_MS = 30_000;
const noMentions = { allowedMentions: { parse: [] } } as const;
const ephemeral = MessageFlags.Ephemeral;

const HELP = [
	"Ping me or reply to my message and I'll answer using what was said in this chat. " +
		"I also reply to random messages sometimes.",
	"",
	"`/gen [text] [user]` - generate text, continuing yours if given; with `user` - in the style of that person",
	"`/impact [words] [user]`, `/lobster [words] [user]` - meme from a random image of this chat",
	"`/urlgen`, `/attgen` - random link or file from this chat",
	"`/forget [user]` - delete everything I logged from you (admins can pick a user)",
	"`/settings` - this server's settings",
	"",
	"Admins: `/allow` to log this channel, `/log_history` to log old messages, `/set` to change settings.",
	"Channel types: **common** and **private** channels share logs within their type, " +
		"**channel** uses only its own logs.",
].join("\n");

const guildOnly = [InteractionContextType.Guild];
const admin = PermissionFlagsBits.Administrator;

export const commandData = [
	new SlashCommandBuilder()
		.setName("allow")
		.setDescription("Toggle logging of this channel")
		.addStringOption(o =>
			o
				.setName("type")
				.setDescription("Which logs this channel uses")
				.setRequired(true)
				.addChoices(
					{ name: "common — shared by all common channels", value: "common" },
					{ name: "private — shared by all private channels", value: "private" },
					{ name: "channel — only this channel", value: "channel" },
				),
		)
		.setDefaultMemberPermissions(admin)
		.setContexts(guildOnly),
	new SlashCommandBuilder()
		.setName("log_history")
		.setDescription("Log old messages (continues where it stopped last time)")
		.addStringOption(o =>
			o
				.setName("where")
				.setDescription("This channel or every logged channel of the server")
				.addChoices({ name: "this channel", value: "this" }, { name: "all logged channels", value: "all" }),
		)
		.setDefaultMemberPermissions(admin)
		.setContexts(guildOnly),
	new SlashCommandBuilder()
		.setName("gen")
		.setDescription("Generate text")
		.addStringOption(o => o.setName("text").setDescription("Beginning to continue"))
		.addUserOption(o => o.setName("user").setDescription("Talk like this person"))
		.setContexts(guildOnly),
	new SlashCommandBuilder()
		.setName("impact")
		.setDescription("Impact meme from a random image of this chat")
		.addStringOption(o => o.setName("words").setDescription("Topic of the caption"))
		.addUserOption(o => o.setName("user").setDescription("Captions in the style of this person"))
		.setContexts(guildOnly),
	new SlashCommandBuilder()
		.setName("lobster")
		.setDescription("Oldschool vk subtitled image from a random image of this chat")
		.addStringOption(o => o.setName("words").setDescription("Topic of the caption"))
		.addUserOption(o => o.setName("user").setDescription("Caption in the style of this person"))
		.setContexts(guildOnly),
	new SlashCommandBuilder().setName("urlgen").setDescription("Random link from this chat").setContexts(guildOnly),
	new SlashCommandBuilder().setName("attgen").setDescription("Random file from this chat").setContexts(guildOnly),
	new SlashCommandBuilder()
		.setName("forget")
		.setDescription("Delete everything the bot logged from you")
		.addUserOption(o => o.setName("user").setDescription("Someone else (admins only)"))
		.setContexts(guildOnly),
	new SlashCommandBuilder().setName("settings").setDescription("Show this server's settings").setContexts(guildOnly),
	new SlashCommandBuilder()
		.setName("set")
		.setDescription("Change a setting of this server")
		.addStringOption(o =>
			o
				.setName("setting")
				.setDescription("Setting")
				.setRequired(true)
				.addChoices(...Object.keys(SETTINGS).map(key => ({ name: key, value: key }))),
		)
		.addNumberOption(o => o.setName("value").setDescription("New value").setRequired(true))
		.setDefaultMemberPermissions(admin)
		.setContexts(guildOnly),
	new SlashCommandBuilder().setName("help").setDescription("What this bot does").setContexts(guildOnly),
].map(c => c.toJSON());

function isAdmin(i: Interaction) {
	return i.memberPermissions.has(admin);
}

async function requireContext(i: Interaction): Promise<ChannelContext | null> {
	const ctx = i.channel ? contextFor(i.channel) : null;
	if (!ctx) await i.reply({ content: NOT_LOGGED, flags: ephemeral });
	return ctx;
}

async function allow(i: Interaction) {
	if (!i.channel) return;
	const type = i.options.getString("type", true) as ChannelType;
	const current = getChannelType(i.guildId, i.channelId);
	if (current && current !== type) {
		await i.reply({
			content: `This channel is already **${current}**. Remove it from **${current}** first.`,
			flags: ephemeral,
		});
		return;
	}
	setChannelType(i.guildId, i.channelId, current ? null : type);
	await i.reply(current ? `Stopped logging this channel (**${type}**).` : `Now logging this channel as **${type}**.`);
}

async function historyTargets(i: Interaction): Promise<GuildTextBasedChannel[]> {
	if (i.options.getString("where") !== "all") return i.channel && contextFor(i.channel) ? [i.channel] : [];

	const channels: GuildTextBasedChannel[] = [];
	for (const row of guildChannels(i.guildId)) {
		const channel = await client.channels.fetch(row.channel_id).catch(() => null);
		if (channel?.isTextBased() && !channel.isDMBased() && channel.guildId === i.guildId) channels.push(channel);
	}
	return channels;
}

async function runHistory(channels: GuildTextBasedChannel[], status: Message) {
	const stats: HistoryStats = { messages: 0, attachments: 0 };
	const problems: string[] = [];
	let current = "";
	let lastUpdate = Date.now();

	const render = () =>
		`Logging history: ${current}\n${stats.messages} new messages, ${stats.attachments} attachments.`;
	const update = () => {
		if (Date.now() - lastUpdate < PROGRESS_INTERVAL_MS) return;
		lastUpdate = Date.now();
		status.edit({ content: render(), ...noMentions }).catch(() => {});
	};

	for (const [index, channel] of channels.entries()) {
		const ctx = contextFor(channel);
		if (!ctx) continue;
		const perms = channel.permissionsFor(client.user!);
		if (!perms?.has(["ViewChannel", "ReadMessageHistory"])) {
			problems.push(`<#${channel.id}>: no access to the history`);
			continue;
		}
		current = `<#${channel.id}> (${index + 1}/${channels.length})`;
		try {
			await logChannelHistory(channel, ctx, stats, update);
		} catch (e) {
			logError(`log_history failed in ${channel.id}`, e);
			problems.push(`<#${channel.id}>: ${e instanceof Error ? e.message : e}`);
		}
	}

	const summary = [
		`History logged from ${channels.length} channel(s): ` +
			`${stats.messages} new messages, ${stats.attachments} attachments.`,
		...problems.map(p => `⚠️ ${p}`),
	].join("\n");
	await status.edit({ content: summary, ...noMentions }).catch(() => {});
}

async function logHistory(i: Interaction) {
	if (!i.channel) return;
	if (historyRunning.has(i.guildId)) {
		await i.reply({ content: "History logging is already running on this server.", flags: ephemeral });
		return;
	}
	const channels = await historyTargets(i);
	if (!channels.length) {
		await i.reply({ content: NOT_LOGGED, flags: ephemeral });
		return;
	}

	await i.reply(
		`Logging history of ${channels.length} channel(s). Random replies are paused until it's done. ` +
			"Progress will be posted below.",
	);
	const status = await i.channel.send({ content: "Starting…", ...noMentions });
	historyRunning.add(i.guildId);
	runHistory(channels, status)
		.catch(e => logError("log_history crashed", e))
		.finally(() => historyRunning.delete(i.guildId));
}

interface StyleTarget {
	id: string;
	name: string;
}

function styleTarget(i: Interaction): StyleTarget | null {
	const user = i.options.getUser("user");
	if (!user) return null;
	return { id: user.id, name: i.options.getMember("user")?.displayName ?? user.displayName };
}

// The reply is already deferred. false means there isn't enough material and the user has been told so
async function checkStyleTarget(i: Interaction, ctx: ChannelContext, target: StyleTarget | null) {
	if (!target || (await hasEnoughFrom(ctx, target.id))) return true;
	await i.editReply({
		content:
			`I don't know enough messages from **${target.name}** in this chat yet ` +
			`(need at least ${MIN_AUTHOR_SENTENCES} sentences).`,
		...noMentions,
	});
	return false;
}

async function gen(i: Interaction) {
	const ctx = await requireContext(i);
	if (!ctx) return;
	await i.deferReply();
	const target = styleTarget(i);
	if (!(await checkStyleTarget(i, ctx, target))) return;

	const generated = await generateText(ctx, {
		prefix: i.options.getString("text") ?? undefined,
		authorId: target?.id,
	});
	const text = generated && i.channel ? resolveEmojis(generated, i.channel) : generated;
	if (!text) return void (await i.editReply("I have nothing to say yet."));
	await i.editReply({ content: target ? `**${target.name}**: ${text}` : text, ...noMentions });
}

async function meme(i: Interaction, kind: "impact" | "lobster") {
	const ctx = await requireContext(i);
	if (!ctx) return;
	await i.deferReply();
	const target = styleTarget(i);
	if (!(await checkStyleTarget(i, ctx, target))) return;

	const buf = await makeMeme(ctx, kind, i.options.getString("words") ?? "", target?.id);
	if (!buf) return void (await i.editReply("Not enough images or text in this chat yet."));
	await i.editReply({ files: [new AttachmentBuilder(buf, { name: `${kind}.jpg` })] });
}

async function urlgen(i: Interaction) {
	const ctx = await requireContext(i);
	if (!ctx) return;
	await i.deferReply();
	await i.editReply((await randomUrl(ctx)) ?? "No working links found.");
}

async function attgen(i: Interaction) {
	const ctx = await requireContext(i);
	if (!ctx) return;
	await i.deferReply();
	await i.editReply((await randomFile(ctx)) ?? "No files found.");
}

async function forget(i: Interaction) {
	const target = i.options.getUser("user");
	if (target && target.id !== i.user.id && !isAdmin(i)) {
		await i.reply({ content: NO_RIGHTS, flags: ephemeral });
		return;
	}
	const userId = target?.id ?? i.user.id;
	const result = forgetAuthor(i.guildId, userId);
	applyRemoval(result, true);
	await i.reply({
		content: `Forgot ${result.messages} messages and ${result.attachments} files from <@${userId}>.`,
		flags: ephemeral,
	});
}

async function showSettings(i: Interaction) {
	const settings = getSettings(i.guildId);
	const lines = (Object.keys(SETTINGS) as SettingKey[]).map(
		key => `${key} = ${settings[key]}  (${SETTINGS[key].min}–${SETTINGS[key].max}, ${SETTINGS[key].description})`,
	);
	await i.reply({ content: `\`\`\`${lines.join("\n")}\`\`\``, flags: ephemeral });
}

async function changeSetting(i: Interaction) {
	if (!isAdmin(i)) return void (await i.reply({ content: NO_RIGHTS, flags: ephemeral }));
	const key = i.options.getString("setting", true);
	if (!isSettingKey(key)) return void (await i.reply({ content: "Unknown setting.", flags: ephemeral }));
	const error = setSetting(i.guildId, key, i.options.getNumber("value", true));
	await i.reply(error ? { content: error, flags: ephemeral } : `Set **${key}** to ${getSettings(i.guildId)[key]}.`);
}

export async function handleCommand(i: Interaction) {
	switch (i.commandName) {
		case "allow":
			return allow(i);
		case "log_history":
			return logHistory(i);
		case "gen":
			return gen(i);
		case "impact":
		case "lobster":
			return meme(i, i.commandName);
		case "urlgen":
			return urlgen(i);
		case "attgen":
			return attgen(i);
		case "forget":
			return forget(i);
		case "settings":
			return showSettings(i);
		case "set":
			return changeSetting(i);
		case "help":
			return i.reply({ content: HELP, flags: ephemeral });
	}
}
