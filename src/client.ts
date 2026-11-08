import { Client, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig } from "./config.js";
import { initSettings } from "./settings.js";

export const cfg = loadConfig();
initSettings(cfg);

export const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMessageReactions,
	],
	// Without partials discord.js doesn't emit deletes, edits and reactions of uncached messages
	partials: [Partials.Message, Partials.Reaction],
});
