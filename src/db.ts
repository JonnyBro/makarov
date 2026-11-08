import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR } from "./config.js";

export const DB_PATH = path.join(DATA_DIR, "makarov.db");
export const IMAGES_DIR = path.join(DATA_DIR, "images");

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

// scope: "common" | "private" | "channel:<id>": what to generate from and where it may be posted
db.exec(`
CREATE TABLE IF NOT EXISTS channels (
	channel_id TEXT PRIMARY KEY,
	guild_id   TEXT NOT NULL,
	type       TEXT NOT NULL CHECK (type IN ('channel', 'common', 'private'))
);
CREATE INDEX IF NOT EXISTS channels_guild ON channels (guild_id);

-- One row per message, sentences separated by \\n.
-- Rows imported from the old logs have no message_id, author or time.
CREATE TABLE IF NOT EXISTS messages (
	id         INTEGER PRIMARY KEY,
	message_id TEXT UNIQUE,
	guild_id   TEXT NOT NULL,
	scope      TEXT NOT NULL,
	channel_id TEXT,
	author_id  TEXT,
	created_at INTEGER,
	content    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_scope ON messages (guild_id, scope, id);
CREATE INDEX IF NOT EXISTS messages_author ON messages (guild_id, author_id);
CREATE INDEX IF NOT EXISTS messages_scope_author ON messages (guild_id, scope, author_id, id);

CREATE TABLE IF NOT EXISTS links (
	id         INTEGER PRIMARY KEY,
	message_id TEXT,
	guild_id   TEXT NOT NULL,
	scope      TEXT NOT NULL,
	author_id  TEXT,
	nsfw       INTEGER NOT NULL DEFAULT 0,
	url        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS links_scope ON links (guild_id, scope);
CREATE INDEX IF NOT EXISTS links_message ON links (message_id);
CREATE INDEX IF NOT EXISTS links_author ON links (guild_id, author_id);

-- Images are stored once on disk (images/<hash>.jpg), references to them live in attachments
CREATE TABLE IF NOT EXISTS images (
	hash       TEXT PRIMARY KEY,
	width      INTEGER NOT NULL,
	height     INTEGER NOT NULL,
	bytes      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
	id            INTEGER PRIMARY KEY,
	attachment_id TEXT UNIQUE,
	message_id    TEXT,
	guild_id      TEXT NOT NULL,
	scope         TEXT NOT NULL,
	channel_id    TEXT,
	author_id     TEXT,
	created_at    INTEGER,
	nsfw          INTEGER NOT NULL DEFAULT 0,
	kind          TEXT NOT NULL CHECK (kind IN ('image', 'file')),
	image_hash    TEXT REFERENCES images (hash),
	filename      TEXT
);
CREATE INDEX IF NOT EXISTS attachments_scope ON attachments (guild_id, scope, kind);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments (message_id);
CREATE INDEX IF NOT EXISTS attachments_author ON attachments (guild_id, author_id);
CREATE INDEX IF NOT EXISTS attachments_image ON attachments (image_hash);
CREATE INDEX IF NOT EXISTS attachments_guild_created ON attachments (guild_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
	guild_id TEXT PRIMARY KEY,
	json     TEXT NOT NULL
);

-- How far log_history got in a channel, so it can continue after a restart
CREATE TABLE IF NOT EXISTS history_progress (
	channel_id TEXT PRIMARY KEY,
	newest_id  TEXT,
	oldest_id  TEXT,
	done       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS migrations (
	guild_id    TEXT PRIMARY KEY,
	migrated_at INTEGER NOT NULL
);
`);

export function imagePath(hash: string) {
	return path.join(IMAGES_DIR, hash.slice(0, 2), `${hash}.jpg`);
}
