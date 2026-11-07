import path from "node:path";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { INTERNAL_DIR } from "./config.js";

GlobalFonts.registerFromPath(path.join(INTERNAL_DIR, "impact.ttf"), "MakarovImpact");
GlobalFonts.registerFromPath(path.join(INTERNAL_DIR, "lobster.ttf"), "MakarovLobster");

type Gravity = "north" | "south";

interface CaptionOptions {
	font: string;
	size: number;
	gravity: Gravity;
	padX: number;
	padY: number;
	stroke?: number;
	shadow?: boolean;
}

function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const candidate = line ? `${line} ${word}` : word;
		if (!line || ctx.measureText(candidate).width <= maxWidth) line = candidate;
		else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

function drawCaption(ctx: SKRSContext2D, text: string, width: number, height: number, opts: CaptionOptions) {
	const stroke = opts.stroke ?? 0;
	const maxWidth = width - opts.padX * 2 - stroke;
	let size = opts.size;
	let lines: string[];
	let ascent: number;
	let lineHeight: number;

	// ImageMagick caption переносил текст сам; тут дополнительно уменьшаем шрифт, чтобы подпись не съела всю картинку
	for (;;) {
		ctx.font = `${size}px "${opts.font}"`;
		lines = wrapLines(ctx, text, maxWidth);
		const m = ctx.measureText("ÀgW");
		ascent = m.fontBoundingBoxAscent || size * 0.8;
		lineHeight = ascent + (m.fontBoundingBoxDescent || size * 0.2);
		const fits =
			lines.every(l => ctx.measureText(l).width <= maxWidth) && lines.length * lineHeight <= height * 0.45;
		if (fits || size <= 10) break;
		size = Math.max(10, Math.floor(size * 0.9));
	}

	const blockHeight = lines.length * lineHeight;
	const top = opts.gravity === "north" ? opts.padY + stroke / 2 : height - opts.padY - stroke / 2 - blockHeight;

	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";
	ctx.lineJoin = "round";
	ctx.lineWidth = stroke;
	ctx.strokeStyle = "#000000";
	ctx.fillStyle = "#ffffff";

	lines.forEach((line, i) => {
		const y = top + ascent + i * lineHeight;
		if (stroke > 0) ctx.strokeText(line, width / 2, y);
		if (opts.shadow) {
			ctx.save();
			ctx.shadowColor = "rgba(0, 0, 0, 0.95)";
			ctx.shadowBlur = Math.max(6, size / 6);
			ctx.fillText(line, width / 2, y);
			ctx.fillText(line, width / 2, y);
			ctx.restore();
		}
		ctx.fillText(line, width / 2, y);
	});
}

async function prepare(imagePath: string) {
	const img = await loadImage(imagePath);
	const canvas = createCanvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return { canvas, ctx, width: img.width, height: img.height };
}

export async function genImpact(imagePath: string, captions: { text: string; gravity: Gravity }[]): Promise<Buffer> {
	const { canvas, ctx, width, height } = await prepare(imagePath);
	const size = Math.max(Math.floor(height / 15), 16);
	for (const { text, gravity } of captions)
		drawCaption(ctx, text.toUpperCase(), width, height, {
			font: "MakarovImpact",
			size,
			gravity,
			padX: Math.floor(width / 120),
			padY: Math.floor(height / 120),
			stroke: size * 0.16,
		});

	return canvas.encode("jpeg", 85);
}

export async function genLobster(imagePath: string, text: string): Promise<Buffer> {
	const { canvas, ctx, width, height } = await prepare(imagePath);

	const gradHeight = Math.floor(height * 0.1);
	const gradTop = height - gradHeight + 2;
	const gradient = ctx.createLinearGradient(0, gradTop, 0, height);
	gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
	gradient.addColorStop(1, "rgba(0, 0, 0, 0.4)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, gradTop, width, gradHeight);

	drawCaption(ctx, text, width, height, {
		font: "MakarovLobster",
		size: Math.max(Math.floor((height / 15) * 1.5), 16),
		gravity: "south",
		padX: Math.floor(width / 200),
		padY: Math.floor(height / 200),
		shadow: true,
	});
	return canvas.encode("jpeg", 85);
}
