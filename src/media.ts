import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { db, imagePath } from "./db.js";
import { logError } from "./logger.js";
import { insertAttachment, type MessageMeta } from "./storage.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 1280;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif)/i;

export function looksLikeImage(name: string, contentType?: string | null) {
	return contentType ? IMAGE_TYPE.test(contentType) : IMAGE_EXT.test(name);
}

const q = {
	image: db.prepare<[string], number>("SELECT 1 FROM images WHERE hash = ?").pluck(),
	insertImage: db.prepare("INSERT OR IGNORE INTO images (hash, width, height, bytes) VALUES (?, ?, ?, ?)"),
	refs: db.prepare<[string], number>("SELECT COUNT(*) FROM attachments WHERE image_hash = ?").pluck(),
	deleteImage: db.prepare("DELETE FROM images WHERE hash = ?"),
	guildBytes: db
		.prepare<[string], number>(
			`SELECT COALESCE(SUM(bytes), 0) FROM images
		WHERE hash IN (SELECT image_hash FROM attachments WHERE guild_id = ? AND kind = 'image')`,
		)
		.pluck(),
	oldestImages: db.prepare<[string], { id: number; image_hash: string }>(
		`SELECT id, image_hash FROM attachments WHERE guild_id = ? AND kind = 'image'
		ORDER BY COALESCE(created_at, 0), id LIMIT 100`,
	),
	deleteAttachment: db.prepare("DELETE FROM attachments WHERE id = ?"),
};

// The hash is taken from the original file: the same meme uploaded again is stored once
export async function storeImage(original: Buffer): Promise<string | null> {
	const hash = crypto.createHash("sha256").update(original).digest("hex");
	if (q.image.get(hash)) return hash;

	let img;
	try {
		img = await loadImage(original);
	} catch {
		return null;
	}
	const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
	const width = Math.max(1, Math.round(img.width * scale));
	const height = Math.max(1, Math.round(img.height * scale));
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");
	// jpeg has no transparency: fill with white, otherwise transparent png turn black
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(img, 0, 0, width, height);
	const out = await canvas.encode("jpeg", 85);

	const file = imagePath(hash);
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	await fs.promises.writeFile(file, out);
	q.insertImage.run(hash, width, height, out.length);
	return hash;
}

// Deletes image files that no attachment references anymore
export function releaseImages(hashes: Iterable<string>) {
	for (const hash of new Set(hashes)) {
		if (q.refs.get(hash)) continue;
		q.deleteImage.run(hash);
		fs.promises.rm(imagePath(hash), { force: true }).catch(e => logError(`failed to delete image ${hash}`, e));
	}
}

export function enforceQuota(guildId: string, quotaBytes: number): number {
	let removed = 0;
	while (q.guildBytes.get(guildId)! > quotaBytes) {
		const batch = q.oldestImages.all(guildId);
		if (!batch.length) break;
		db.transaction(() => {
			for (const row of batch) q.deleteAttachment.run(row.id);
		})();
		releaseImages(batch.map(r => r.image_hash));
		removed += batch.length;
	}
	return removed;
}

export interface IncomingAttachment {
	id: string;
	url: string;
	name: string;
	size: number;
	contentType: string | null;
}

// Images are downloaded and kept locally (needed for impact/lobster), other files only as a reference to the message
export async function saveAttachment(meta: MessageMeta, att: IncomingAttachment, quotaBytes: number) {
	if (looksLikeImage(att.name, att.contentType) && att.size <= MAX_IMAGE_BYTES)
		try {
			const res = await fetch(att.url);
			if (res.ok) {
				const hash = await storeImage(Buffer.from(await res.arrayBuffer()));
				if (hash) {
					insertAttachment(meta, {
						attachmentId: att.id,
						kind: "image",
						imageHash: hash,
						filename: att.name,
					});
					enforceQuota(meta.guildId, quotaBytes);
					return;
				}
			}
		} catch (e) {
			logError(`failed to store image ${att.url}`, e);
		}

	insertAttachment(meta, { attachmentId: att.id, kind: "file", imageHash: null, filename: att.name });
}
