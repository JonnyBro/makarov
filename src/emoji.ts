import { PermissionFlagsBits, type Collection, type Emoji, type GuildTextBasedChannel } from "discord.js";
import { client } from "./client.js";

// Logged text comes from cleanContent, which turns custom emojis "<:name:id>" into ":name:".
// Discord only renders the full form, so the names are looked up again when the bot speaks.
// The lookbehind/lookahead keep times like "12:30:45" and URLs out.
const SHORTCODE = /(?<![\w/]):([\w~]{2,32}):(?!\w)/g;
const HAS_LETTER = /[a-z]/i;

function find(cache: Collection<string, Emoji>, name: string): Emoji | undefined {
	const lower = name.toLowerCase();
	const usable = (e: Emoji) => !("available" in e) || e.available !== false;
	return (
		cache.find(e => e.name === name && usable(e)) ?? cache.find(e => e.name?.toLowerCase() === lower && usable(e))
	);
}

function tidy(text: string) {
	return text
		.replace(/[ \t]{2,}/g, " ")
		.replace(/ *\n */g, "\n")
		.trim();
}

// Replaces ":name:" with an emoji of this server, or of another server the bot is in if it may use external
// emojis here. Names that can't be found are dropped instead of being posted as plain text.
export function resolveEmojis(text: string, channel: GuildTextBasedChannel): string {
	const external = channel.permissionsFor(client.user!)?.has(PermissionFlagsBits.UseExternalEmojis) ?? false;
	return tidy(
		text.replace(SHORTCODE, (whole, name: string) => {
			if (!HAS_LETTER.test(name)) return whole;
			const emoji =
				find(channel.guild.emojis.cache, name) ?? (external ? find(client.emojis.cache, name) : undefined);
			return emoji?.toString() ?? "";
		}),
	);
}

// Custom emojis can't be drawn on images
export function stripEmojis(text: string): string {
	return tidy(text.replace(SHORTCODE, (whole, name: string) => (HAS_LETTER.test(name) ? "" : whole)));
}
