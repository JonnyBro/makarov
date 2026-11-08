import { db } from "./db.js";

export const CHANNEL_TYPES = ["channel", "common", "private"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const URL_RE = /https?:\/\/[^\s<>|]*[^\s<>|.,!?:;)\]'"]/g;

export function scopeOf(type: ChannelType, channelId: string) {
	return type === "channel" ? `channel:${channelId}` : type;
}

export function choice<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export interface MessageMeta {
	messageId: string | null;
	guildId: string;
	scope: string;
	channelId: string | null;
	authorId: string | null;
	createdAt: number | null;
	nsfw: boolean;
}

export interface AttachmentRow {
	id: number;
	attachment_id: string | null;
	message_id: string | null;
	channel_id: string | null;
	kind: "image" | "file";
	image_hash: string | null;
	filename: string | null;
}

const q = {
	channelType: db
		.prepare<[string, string], string>("SELECT type FROM channels WHERE channel_id = ? AND guild_id = ?")
		.pluck(),
	setChannel: db.prepare(
		`INSERT INTO channels (channel_id, guild_id, type) VALUES (?, ?, ?)
		ON CONFLICT (channel_id) DO UPDATE SET guild_id = excluded.guild_id, type = excluded.type`,
	),
	removeChannel: db.prepare("DELETE FROM channels WHERE channel_id = ?"),
	guildChannels: db.prepare<[string], { channel_id: string; type: ChannelType }>(
		"SELECT channel_id, type FROM channels WHERE guild_id = ?",
	),
	getProgress: db.prepare<[string], { newest_id: string | null; oldest_id: string | null; done: number }>(
		"SELECT newest_id, oldest_id, done FROM history_progress WHERE channel_id = ?",
	),
	setProgress: db.prepare(
		`INSERT INTO history_progress (channel_id, newest_id, oldest_id, done) VALUES (?, ?, ?, ?)
		ON CONFLICT (channel_id) DO UPDATE
		SET newest_id = excluded.newest_id, oldest_id = excluded.oldest_id, done = excluded.done`,
	),

	messageExists: db.prepare<[string], number>("SELECT 1 FROM messages WHERE message_id = ?").pluck(),
	insertMessage: db.prepare(
		`INSERT OR IGNORE INTO messages (message_id, guild_id, scope, channel_id, author_id, created_at, content)
		VALUES (@messageId, @guildId, @scope, @channelId, @authorId, @createdAt, @content)`,
	),
	insertLink: db.prepare(
		`INSERT INTO links (message_id, guild_id, scope, author_id, nsfw, url)
		VALUES (@messageId, @guildId, @scope, @authorId, @nsfw, @url)`,
	),
	insertAttachment: db.prepare(
		`INSERT OR IGNORE INTO attachments
		(attachment_id, message_id, guild_id, scope, channel_id, author_id, created_at,
			nsfw, kind, image_hash, filename)
		VALUES (@attachmentId, @messageId, @guildId, @scope, @channelId, @authorId, @createdAt,
			@nsfw, @kind, @imageHash, @filename)`,
	),

	messageScope: db.prepare<[string], { guild_id: string; scope: string; content: string }>(
		"SELECT guild_id, scope, content FROM messages WHERE message_id = ?",
	),
	updateContent: db.prepare("UPDATE messages SET content = ? WHERE message_id = ?"),
	deleteMessage: db.prepare("DELETE FROM messages WHERE message_id = ?"),
	deleteLinks: db.prepare("DELETE FROM links WHERE message_id = ?"),
	messageImages: db
		.prepare<[string], string>("SELECT image_hash FROM attachments WHERE message_id = ? AND image_hash IS NOT NULL")
		.pluck(),
	deleteAttachments: db.prepare("DELETE FROM attachments WHERE message_id = ?"),

	authorScopes: db
		.prepare<[string, string], string>("SELECT DISTINCT scope FROM messages WHERE guild_id = ? AND author_id = ?")
		.pluck(),
	authorImages: db
		.prepare<[string, string], string>(
			"SELECT image_hash FROM attachments WHERE guild_id = ? AND author_id = ? AND image_hash IS NOT NULL",
		)
		.pluck(),
	forgetMessages: db.prepare("DELETE FROM messages WHERE guild_id = ? AND author_id = ?"),
	forgetLinks: db.prepare("DELETE FROM links WHERE guild_id = ? AND author_id = ?"),
	forgetAttachments: db.prepare("DELETE FROM attachments WHERE guild_id = ? AND author_id = ?"),

	topScopes: db.prepare<[number], { guildId: string; scope: string }>(
		"SELECT guild_id AS guildId, scope FROM messages GROUP BY guild_id, scope ORDER BY COUNT(*) DESC LIMIT ?",
	),
	rowsSinceByAuthor: db.prepare<[string, string, string, number], { id: number; content: string }>(
		"SELECT id, content FROM messages WHERE guild_id = ? AND scope = ? AND author_id = ? AND id > ? ORDER BY id",
	),
	rowsSince: db.prepare<[string, string, number], { id: number; content: string }>(
		"SELECT id, content FROM messages WHERE guild_id = ? AND scope = ? AND id > ? ORDER BY id",
	),
	randomLinks: db
		.prepare<[string, string, number, number], string>(
			"SELECT url FROM links WHERE guild_id = ? AND scope = ? AND (nsfw = 0 OR ?) ORDER BY RANDOM() LIMIT ?",
		)
		.pluck(),
	// An image posted many times is picked as often as any other one
	randomImage: db
		.prepare<[string, string, number], string>(
			`SELECT image_hash FROM attachments
		WHERE guild_id = ? AND scope = ? AND kind = 'image' AND (nsfw = 0 OR ?)
		GROUP BY image_hash ORDER BY RANDOM() LIMIT 1`,
		)
		.pluck(),
	randomAttachment: db.prepare<[string, string, number], AttachmentRow>(
		`SELECT id, attachment_id, message_id, channel_id, kind, image_hash, filename FROM attachments
		WHERE id IN (
			SELECT MIN(id) FROM attachments WHERE guild_id = ? AND scope = ? AND (nsfw = 0 OR ?)
			GROUP BY COALESCE(image_hash, 'file:' || id)
		)
		ORDER BY RANDOM() LIMIT 1`,
	),
	deleteAttachmentById: db.prepare("DELETE FROM attachments WHERE id = ?"),
};

export function getChannelType(guildId: string, channelId: string): ChannelType | null {
	return (q.channelType.get(channelId, guildId) as ChannelType | undefined) ?? null;
}

export function setChannelType(guildId: string, channelId: string, type: ChannelType | null) {
	if (type) q.setChannel.run(channelId, guildId, type);
	else q.removeChannel.run(channelId);
}

export function messageExists(messageId: string): boolean {
	return !!q.messageExists.get(messageId);
}

export function insertMessage(meta: MessageMeta, content: string): boolean {
	const { nsfw: _nsfw, ...row } = meta;
	return q.insertMessage.run({ ...row, content }).changes > 0;
}

export function insertLink(meta: MessageMeta, url: string) {
	q.insertLink.run({
		messageId: meta.messageId,
		guildId: meta.guildId,
		scope: meta.scope,
		authorId: meta.authorId,
		nsfw: +meta.nsfw,
		url,
	});
}

export function insertAttachment(
	meta: MessageMeta,
	att: { attachmentId: string | null; kind: "image" | "file"; imageHash: string | null; filename: string | null },
) {
	const { nsfw, ...row } = meta;
	q.insertAttachment.run({ ...row, ...att, nsfw: +nsfw });
}

export interface Removal {
	scopes: { guildId: string; scope: string }[];
	imageHashes: string[];
}

export const updateMessageContent = (messageId: string, content: string) => {
	const row = q.messageScope.get(messageId);
	if (!row || row.content === content) return null;
	q.updateContent.run(content, messageId);
	return { guildId: row.guild_id, scope: row.scope };
};

export const deleteMessages = db.transaction((messageIds: string[]): Removal => {
	const removal: Removal = { scopes: [], imageHashes: [] };
	for (const id of messageIds) {
		const row = q.messageScope.get(id);
		if (row) removal.scopes.push({ guildId: row.guild_id, scope: row.scope });
		removal.imageHashes.push(...q.messageImages.all(id));
		q.deleteMessage.run(id);
		q.deleteLinks.run(id);
		q.deleteAttachments.run(id);
	}
	return removal;
});

export const forgetAuthor = db.transaction((guildId: string, authorId: string) => {
	const scopes = q.authorScopes.all(guildId, authorId).map(scope => ({ guildId, scope }));
	const imageHashes = q.authorImages.all(guildId, authorId);
	const messages = q.forgetMessages.run(guildId, authorId).changes;
	q.forgetLinks.run(guildId, authorId);
	const attachments = q.forgetAttachments.run(guildId, authorId).changes;
	return { scopes, imageHashes, messages, attachments };
});

export function rowsSince(guildId: string, scope: string, afterId: number, authorId?: string) {
	if (authorId) return q.rowsSinceByAuthor.iterate(guildId, scope, authorId, afterId);
	return q.rowsSince.iterate(guildId, scope, afterId);
}

export function randomLinks(guildId: string, scope: string, allowNsfw: boolean, limit: number): string[] {
	return q.randomLinks.all(guildId, scope, +allowNsfw, limit);
}

export function randomImageHash(guildId: string, scope: string, allowNsfw: boolean): string | null {
	return q.randomImage.get(guildId, scope, +allowNsfw) ?? null;
}

export function randomAttachmentRow(guildId: string, scope: string, allowNsfw: boolean): AttachmentRow | null {
	return q.randomAttachment.get(guildId, scope, +allowNsfw) ?? null;
}

export function deleteAttachmentRow(id: number) {
	q.deleteAttachmentById.run(id);
}

export function guildChannels(guildId: string) {
	return q.guildChannels.all(guildId);
}

export interface HistoryProgress {
	newestId: string | null;
	oldestId: string | null;
	done: boolean;
}

export function getHistoryProgress(channelId: string): HistoryProgress {
	const row = q.getProgress.get(channelId);
	return { newestId: row?.newest_id ?? null, oldestId: row?.oldest_id ?? null, done: !!row?.done };
}

export function setHistoryProgress(channelId: string, progress: HistoryProgress) {
	q.setProgress.run(channelId, progress.newestId, progress.oldestId, +progress.done);
}

export function topScopes(limit: number) {
	return q.topScopes.all(limit);
}
