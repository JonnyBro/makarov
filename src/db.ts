import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR } from "./config.js";
import { searchStems } from "./text.js";

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
CREATE TABLE IF NOT EXISTS messages (
	id         INTEGER PRIMARY KEY,
	message_id TEXT UNIQUE,
	guild_id   TEXT NOT NULL,
	scope      TEXT NOT NULL,
	channel_id TEXT,
	author_id  TEXT,
	created_at INTEGER,
	content    TEXT NOT NULL,
	reply_to   TEXT
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

`);

// A message sent by someone else within this time after the previous one counts as a reply to it
export const REPLY_WINDOW_MS = 2 * 60 * 1000;

// Schema upgrades for databases created by older versions, tracked with PRAGMA user_version
const upgrades: (() => void)[] = [
	() => {
		const columns = db.prepare<[], { name: string }>("PRAGMA table_info(messages)").all();
		if (!columns.some(c => c.name === "reply_to")) db.exec("ALTER TABLE messages ADD COLUMN reply_to TEXT");
		db.exec("CREATE INDEX IF NOT EXISTS messages_reply ON messages (reply_to)");
		// remove_diacritics 0: otherwise "й" is folded into "и"
		db.exec(
			"CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts " +
				"USING fts5(stems, tokenize = 'unicode61 remove_diacritics 0')",
		);

		// Messages logged before reply tracking: the previous message in the channel from someone else,
		// sent shortly before, is taken as the one being answered
		db.prepare(
			`WITH ordered AS (
				SELECT id, LAG(message_id) OVER w AS prev_id, LAG(author_id) OVER w AS prev_author,
					LAG(created_at) OVER w AS prev_at
				FROM messages WHERE message_id IS NOT NULL AND channel_id IS NOT NULL
				WINDOW w AS (PARTITION BY channel_id ORDER BY created_at, id)
			)
			UPDATE messages SET reply_to = o.prev_id FROM ordered o
			WHERE messages.id = o.id AND messages.reply_to IS NULL AND o.prev_id IS NOT NULL
				AND o.prev_author IS NOT messages.author_id AND messages.created_at - o.prev_at <= ?`,
		).run(REPLY_WINDOW_MS);

		// better-sqlite3 can't write while a SELECT iterator is open, so rows are read in pages
		const page = db.prepare<[number], { id: number; content: string }>(
			"SELECT id, content FROM messages WHERE id > ? ORDER BY id LIMIT 5000",
		);
		const insert = db.prepare("INSERT INTO messages_fts (rowid, stems) VALUES (?, ?)");
		for (let rows = page.all(0); rows.length; rows = page.all(rows[rows.length - 1].id))
			for (const row of rows) {
				const stems = searchStems(row.content).join(" ");
				if (stems) insert.run(row.id, stems);
			}
	},
	// Bookkeeping table of the removed import from the Python version's text logs
	() => db.exec("DROP TABLE IF EXISTS migrations"),
];

const version = db.pragma("user_version", { simple: true }) as number;
for (let v = version; v < upgrades.length; v++)
	db.transaction(() => {
		upgrades[v]();
		db.pragma(`user_version = ${v + 1}`);
	})();

export function imagePath(hash: string) {
	return path.join(IMAGES_DIR, hash.slice(0, 2), `${hash}.jpg`);
}
