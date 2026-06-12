// Generate a tray/window icon (a magenta hexagon — Guai's ⬢ mark) as a real PNG,
// using only built-ins (zlib for IDAT, hand-rolled CRC32 for chunks). No binary asset
// is checked in; `npm run make-icon` regenerates it. Pure ESM, no dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZE = 64;
const MAGENTA = [0xd6, 0x33, 0x6c];

// Signed distance to a flat-top regular hexagon (iquilezles), in pixel units.
function sdHexagon(px, py, r) {
  const kx = -0.866025404, ky = 0.5, kz = 0.577350269;
  let x = Math.abs(px), y = Math.abs(py);
  const dot = kx * x + ky * y;
  const t = 2 * Math.min(dot, 0);
  x -= t * kx; y -= t * ky;
  const clamped = Math.max(-kz * r, Math.min(kz * r, x));
  x -= clamped; y -= r;
  return Math.hypot(x, y) * Math.sign(y);
}

const px = Buffer.alloc(SIZE * SIZE * 4); // RGBA, transparent by default
const c = (SIZE - 1) / 2;
const r = SIZE * 0.46;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = sdHexagon(x - c, y - c, r);
    const a = Math.max(0, Math.min(1, 0.5 - d)); // 1px anti-aliased edge
    if (a > 0) {
      const i = (y * SIZE + x) * 4;
      px[i] = MAGENTA[0]; px[i + 1] = MAGENTA[1]; px[i + 2] = MAGENTA[2];
      px[i + 3] = Math.round(a * 255);
    }
  }
}

// --- minimal PNG encoder ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; t[n] = v >>> 0; }
  return t;
})();
const crc32 = (buf) => { let v = 0xffffffff; for (let i = 0; i < buf.length; i++) v = crcTable[(v ^ buf[i]) & 0xff] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
// scanlines, each prefixed by filter byte 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(join(HERE, 'assets'), { recursive: true });
const out = join(HERE, 'assets', 'icon.png');
writeFileSync(out, png);
console.log(`Wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
