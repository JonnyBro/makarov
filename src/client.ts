import { Client, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig } from "./config.js";
import { initSettings } from "./settings.js";

export const cfg = loadConfig();
initSettings(cfg);

export const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
	// Without partials discord.js doesn't emit deletes and edits of uncached messages
	partials: [Partials.Message],
});
