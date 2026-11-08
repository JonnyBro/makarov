// One-off import of the Python version's internal/ folder into the database. The original files aren't touched.
// pnpm migrate <path to the old internal folder> [--force] [--keep-duplicates]
import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "./db.js";
import { MAX_IMAGE_BYTES, storeImage } from "./media.js";
import {
	CHANNEL_TYPES,
	insertAttachment,
	insertLink,
	insertMessage,
	scopeOf,
	URL_RE,
	type MessageMeta,
} from "./storage.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const LEGACY_DIR = args.find(a => !a.startsWith("--"));
const keepDuplicates = process.argv.includes("--keep-duplicates");

const LOG_FILE = /^(common|private|\d+)_msg_logs\.makarov$/;
const ATTACHMENT_FILE = /^(common|private|channel|\d+)_attachment_(\d+(?:\.\d+)?)_(.+)$/;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const URL_ONLY = /^https?:\/\/\S+$/;

const q = {
	migrated: db.prepare<[string], number>("SELECT 1 FROM migrations WHERE guild_id = ?").pluck(),
	markMigrated: db.prepare(
		"INSERT INTO migrations (guild_id, migrated_at) VALUES (?, ?) " +
			"ON CONFLICT (guild_id) DO UPDATE SET migrated_at = excluded.migrated_at",
	),
	setChannel: db.prepare("INSERT OR IGNORE INTO channels (channel_id, guild_id, type) VALUES (?, ?, ?)"),
	setSettings: db.prepare("INSERT OR IGNORE INTO settings (guild_id, json) VALUES (?, ?)"),
};

function scopeFromPrefix(prefix: string) {
	return prefix === "common" || prefix === "private" ? prefix : scopeOf("channel", prefix);
}

function migrateText(guildId: string, dir: string, files: string[]) {
	const stats = { channels: 0, messages: 0, duplicates: 0, links: 0, settings: false };

	db.transaction(() => {
		// Same order as the old getChannelType: if a channel is in several lists, the first one wins
		for (const type of CHANNEL_TYPES) {
			const file = path.join(dir, `whitelisted_channels_${type}.makarov`);
			if (!fs.existsSync(file)) continue;
			for (const id of fs.readFileSync(file, "utf-8").match(/\d+/g) ?? [])
				stats.channels += q.setChannel.run(id, guildId, type).changes;
		}

		const settingsFile = path.join(dir, "settings.json");
		if (fs.existsSync(settingsFile)) {
			q.setSettings.run(guildId, JSON.stringify(JSON.parse(fs.readFileSync(settingsFile, "utf-8"))));
			stats.settings = true;
		}

		for (const name of files) {
			const match = LOG_FILE.exec(name);
			if (!match) continue;
			const scope = scopeFromPrefix(match[1]);
			const meta: MessageMeta = {
				messageId: null,
				guildId,
				scope,
				channelId: scope.startsWith("channel:") ? match[1] : null,
				authorId: null,
				createdAt: null,
				nsfw: false,
			};
			const seen = new Set<string>();
			const text = fs.readFileSync(path.join(dir, name)).toString("utf-8").replaceAll("\uFFFD", "");

			for (const raw of text.split("\n")) {
				const line = raw.trim();
				if (!line) continue;
				if (!keepDuplicates) {
					if (seen.has(line)) {
						stats.duplicates++;
						continue;
					}
					seen.add(line);
				}
				for (const url of line.match(URL_RE) ?? []) {
					insertLink(meta, url);
					stats.links++;
				}
				if (!URL_ONLY.test(line)) {
					insertMessage(meta, line);
					stats.messages++;
				}
			}
		}
	})();

	return stats;
}

async function migrateImages(guildId: string, dir: string, files: string[]) {
	const stats = { images: 0, unique: new Set<string>(), orphans: 0, notImages: 0, tooBig: 0, broken: 0 };
	const candidates = files.filter(name => ATTACHMENT_FILE.test(name));

	for (const [i, name] of candidates.entries()) {
		if (i && i % 100 === 0) console.log(`  images: ${i}/${candidates.length}`);
		const [, prefix, time] = ATTACHMENT_FILE.exec(name)!;

		// The old version wrote channel_attachment_* for all channel-type channels at once, so the owner can't be known
		if (prefix === "channel") {
			stats.orphans++;
			continue;
		}
		if (!IMAGE_EXT.test(name)) {
			stats.notImages++;
			continue;
		}
		const file = path.join(dir, name);
		if (fs.statSync(file).size > MAX_IMAGE_BYTES) {
			stats.tooBig++;
			continue;
		}

		const hash = await storeImage(await fs.promises.readFile(file));
		if (!hash) {
			stats.broken++;
			continue;
		}
		const scope = scopeFromPrefix(prefix);
		insertAttachment(
			{
				messageId: null,
				guildId,
				scope,
				channelId: scope.startsWith("channel:") ? prefix : null,
				authorId: null,
				createdAt: Math.round(parseFloat(time) * 1000),
				nsfw: false,
			},
			{ attachmentId: null, kind: "image", imageHash: hash, filename: name },
		);
		stats.images++;
		stats.unique.add(hash);
	}
	return stats;
}

async function main() {
	if (!LEGACY_DIR) {
		console.log("Usage: pnpm migrate <path to the old internal folder> [--force] [--keep-duplicates]");
		process.exitCode = 1;
		return;
	}
	if (!fs.existsSync(LEGACY_DIR)) {
		console.log(`Nothing to migrate: ${LEGACY_DIR} doesn't exist`);
		process.exitCode = 1;
		return;
	}
	console.log(`Migrating ${LEGACY_DIR} -> ${DB_PATH}`);

	const guilds = fs
		.readdirSync(LEGACY_DIR, { withFileTypes: true })
		.filter(d => d.isDirectory() && /^\d+$/.test(d.name))
		.map(d => d.name);

	for (const guildId of guilds) {
		if (q.migrated.get(guildId) && !force) {
			console.log(
				`\n${guildId}: already migrated, skipping (use --force to import again, it will duplicate data)`,
			);
			continue;
		}
		const dir = path.join(LEGACY_DIR, guildId);
		const files = fs.readdirSync(dir);
		console.log(`\n${guildId}:`);

		const text = migrateText(guildId, dir, files);
		console.log(`  channels: ${text.channels}, settings: ${text.settings ? "yes" : "no"}`);
		console.log(`  messages: ${text.messages}, links: ${text.links}, duplicate lines skipped: ${text.duplicates}`);

		const img = await migrateImages(guildId, dir, files);
		console.log(`  images: ${img.images} (${img.unique.size} unique)`);
		if (img.orphans) console.log(`  skipped channel_attachment_* (unknown channel): ${img.orphans}`);
		if (img.notImages) console.log(`  skipped non-image files: ${img.notImages}`);
		if (img.tooBig) console.log(`  skipped images over ${MAX_IMAGE_BYTES / 1024 / 1024} MB: ${img.tooBig}`);
		if (img.broken) console.log(`  skipped unreadable images: ${img.broken}`);

		q.markMigrated.run(guildId, Date.now());
	}

	db.pragma("wal_checkpoint(TRUNCATE)");
	console.log("\nDone. Old files were not touched — delete them yourself once everything works.");
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
