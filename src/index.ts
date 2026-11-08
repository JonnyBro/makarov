import { ActivityType, MessageFlags } from "discord.js";
import { autoReply, directReply, getAddress, isLastBotMessage, noteEngagement } from "./chat.js";
import { cfg, client } from "./client.js";
import { applyRemoval, storeMessage, toSentences, trackChannelMessage } from "./collector.js";
import { commandData, handleCommand } from "./commands.js";
import { contextFor } from "./context.js";
import { logError, logInfo } from "./logger.js";
import { invalidateCorpus, warmUp } from "./markov.js";
import { choice, deleteMessages, topScopes, updateMessageContent } from "./storage.js";

const DEFAULT_STATUSES = ["Remember, no GenAI.", "Last I **can** read messages", "T YESSS IT IT IT T YESSS", "/help"];

function updateStatus() {
	const statuses = cfg.statuses?.length ? cfg.statuses : DEFAULT_STATUSES;
	client.user!.setActivity(choice(statuses).replaceAll(".id.", client.user!.username), {
		type: ActivityType.Playing,
	});
}

client.once("clientReady", async c => {
	try {
		await c.application.commands.set(commandData);
		logInfo(`Registered ${commandData.length} slash commands`);
	} catch (e) {
		logError("failed to register slash commands", e);
	}
	if (cfg.custom_status) {
		updateStatus();
		setInterval(updateStatus, 30_000);
	}
	logInfo(`We have logged in as ${c.user.tag}`);

	const started = Date.now();
	warmUp(topScopes(8)).then(() => logInfo(`Corpora warmed up in ${Date.now() - started} ms`));
});

client.on("messageCreate", async message => {
	if (!message.inGuild()) return;
	const replyTo = trackChannelMessage(message);
	if (message.author.bot) return;

	try {
		const ctx = contextFor(message.channel);
		if (!ctx) return;
		const address = getAddress(message);
		if (address !== null) {
			await directReply(message, ctx, address);
			// Messages addressed to the bot are logged without the ping so the bot's name doesn't pollute the corpus
			await storeMessage(message, ctx, address, replyTo);
		} else {
			await autoReply(message, ctx);
			await storeMessage(message, ctx, message.cleanContent, replyTo);
		}
	} catch (e) {
		logError("error in messageCreate", e);
	}
});

client.on("interactionCreate", async interaction => {
	if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
	try {
		await handleCommand(interaction);
	} catch (e) {
		logError(`command /${interaction.commandName} failed`, e);
		const content = "Something went wrong.";
		if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => {});
		else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
	}
});

client.on("messageUpdate", async (_old, updated) => {
	try {
		const message = updated.partial ? await updated.fetch() : updated;
		if (!message.inGuild() || message.author.bot) return;
		const changed = updateMessageContent(message.id, toSentences(message.cleanContent));
		if (changed) invalidateCorpus(changed.guildId, changed.scope);
	} catch (e) {
		logError("error in messageUpdate", e);
	}
});

client.on("messageReactionAdd", (reaction, user) => {
	if (!user.bot && isLastBotMessage(reaction.message.channelId, reaction.message.id))
		noteEngagement(reaction.message.channelId);
});

client.on("messageDelete", message => {
	try {
		applyRemoval(deleteMessages([message.id]));
	} catch (e) {
		logError("error in messageDelete", e);
	}
});

client.on("messageDeleteBulk", messages => {
	try {
		applyRemoval(deleteMessages([...messages.keys()]));
	} catch (e) {
		logError("error in messageDeleteBulk", e);
	}
});

client.on("error", e => logError("client error", e));

client.login(cfg.token);
