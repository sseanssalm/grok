#!/usr/bin/env node
/**
 * Rasterize the Keel mark (the same K as public/favicon.svg) into launcher
 * PNGs. No native image library: the glyph is a single straight-line polygon.
 *
 * Writes:
 *   resources/icon-1024.png
 *   resources/icon-foreground-1024.png
 *   android/app/src/main/res/mipmap-*\/ic_launcher*.png  (when that tree exists)
 */
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Favicon path, viewBox 32×32. */
const K = [
  [8, 8],
  [11.2, 8],
  [11.2, 14.4],
  [19.2, 8],
  [23, 8],
  [15.9, 15.4],
  [23.4, 24],
  [19.5, 24],
  [14.2, 17.6],
  [14.2, 24],
  [8, 24],
];

const BG = [0x0c, 0x0d, 0x0f];
const FG = [0xf3, 0xf4, 0xf6];

const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inGlyph(px, py, size) {
  return pointInPoly((px / size) * 32, (py / size) * 32, K);
}

function inRoundRect(px, py, size) {
  const r = size * 0.22;
  let dx = 0;
  let dy = 0;
  if (px < r) dx = r - px;
  else if (px > size - r) dx = px - (size - r);
  if (py < r) dy = r - py;
  else if (py > size - r) dy = py - (size - r);
  return dx * dx + dy * dy <= r * r;
}

function inCircle(px, py, size) {
  const c = (size - 1) / 2;
  const d = size / 2;
  return (px - c) * (px - c) + (py - c) * (py - c) <= d * d;
}

function coverage(px, py, size, mask) {
  const n = size >= 512 ? 2 : 4;
  let hit = 0;
  let glyph = 0;
  for (let oy = 0; oy < n; oy++) {
    for (let ox = 0; ox < n; ox++) {
      const x = px + (ox + 0.5) / n;
      const y = py + (oy + 0.5) / n;
      if (!mask(x, y, size)) continue;
      hit++;
      if (inGlyph(x, y, size)) glyph++;
    }
  }
  return { mask: hit / (n * n), glyph: glyph / (n * n) };
}

function render(size, mode) {
  const mask =
    mode === "foreground" ? () => true : mode === "round" ? inCircle : inRoundRect;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sample = coverage(x, y, size, mask);
      const i = (y * size + x) * 4;
      if (mode === "foreground") {
        pixels[i] = FG[0];
        pixels[i + 1] = FG[1];
        pixels[i + 2] = FG[2];
        pixels[i + 3] = Math.round(sample.glyph * 255);
        continue;
      }
      if (sample.mask === 0) continue;
      const t = sample.glyph / sample.mask;
      pixels[i] = Math.round(FG[0] * t + BG[0] * (1 - t));
      pixels[i + 1] = Math.round(FG[1] * t + BG[1] * (1 - t));
      pixels[i + 2] = Math.round(FG[2] * t + BG[2] * (1 - t));
      pixels[i + 3] = Math.round(sample.mask * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writePng(path, size, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(size, render(size, mode)));
}

function assertMark(size, mode) {
  const rgba = render(size, mode);
  const at = (vx, vy) => {
    const x = Math.round((vx / 32) * size);
    const y = Math.round((vy / 32) * size);
    const i = (y * size + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
  };
  const stem = at(9.6, 16);
  const outside = at(30, 16);
  if (stem[0] < 200) throw new Error(`Keel stem did not rasterize (${mode} ${size})`);
  if (mode === "foreground") {
    if (outside[3] !== 0) throw new Error("Foreground should be transparent outside the K");
  } else if (outside[0] > 40) {
    throw new Error(`Background pixel is not the Keel ink (${mode} ${size})`);
  }
}

assertMark(64, "legacy");
assertMark(64, "foreground");

writePng(join(root, "resources/icon-1024.png"), 1024, "legacy");
writePng(join(root, "resources/icon-foreground-1024.png"), 1024, "foreground");

const res = join(root, "android/app/src/main/res");

if (existsSync(res)) {
  for (const [density, size] of Object.entries(LEGACY)) {
    const dir = join(res, `mipmap-${density}`);
    writePng(join(dir, "ic_launcher.png"), size, "legacy");
    writePng(join(dir, "ic_launcher_round.png"), size, "round");
  }
  for (const [density, size] of Object.entries(FOREGROUND)) {
    writePng(join(res, `mipmap-${density}`, "ic_launcher_foreground.png"), size, "foreground");
  }
  console.log("[keel-icon] wrote launcher mipmaps");
} else {
  console.log("[keel-icon] android res/ not present — wrote resources/ only");
}
