import type { GuildTextBasedChannel } from "discord.js";
import { getChannelType, scopeOf, type ChannelType } from "./storage.js";

export interface ChannelContext {
	guildId: string;
	channelId: string;
	type: ChannelType;
	scope: string;
	nsfw: boolean;
}

export function isNsfw(channel: GuildTextBasedChannel): boolean {
	if (channel.isThread()) return channel.parent?.nsfw ?? false;
	return "nsfw" in channel ? channel.nsfw : false;
}

// null means the channel isn't whitelisted: nothing is logged or generated there
export function contextFor(channel: GuildTextBasedChannel): ChannelContext | null {
	const type = getChannelType(channel.guildId, channel.id);
	if (!type) return null;
	return {
		guildId: channel.guildId,
		channelId: channel.id,
		type,
		scope: scopeOf(type, channel.id),
		nsfw: isNsfw(channel),
	};
}
