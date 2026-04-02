'use strict';
// Generates build/icon.ico from the design in build/icon.svg.
// No external dependencies — renders the design via pixel painting.
// Run: node scripts/generate-icon.js

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 256, H = 256;
const px = Buffer.alloc(W * H * 4, 0); // RGBA, fully transparent

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a;
}

// Fills a rounded rectangle. Uses the clamped-distance formula so every
// pixel whose nearest point on the inset rectangle is within radius r is filled.
function fillRoundedRect(x1, y1, x2, y2, r, rv, gv, bv) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const cx = Math.max(x1 + r, Math.min(x2 - r, x));
      const cy = Math.max(y1 + r, Math.min(y2 - r, y));
      if (Math.hypot(x - cx, y - cy) <= r) set(x, y, rv, gv, bv);
    }
  }
}

// ── Rounded-rect background (#1a1a1a) ────────────────────────────────────────
fillRoundedRect(0, 0, W - 1, H - 1, 40, 26, 26, 26);

// ── Three bars — crown shape (#e8863a) ───────────────────────────────────────
//   Left bar:   x 48–92,   y 100–210, height 110
//   Center bar: x 106–150, y  44–210, height 166
//   Right bar:  x 164–208, y 100–210, height 110
fillRoundedRect( 48, 100,  92, 210, 22, 232, 134, 58);
fillRoundedRect(106,  44, 150, 210, 22, 232, 134, 58);
fillRoundedRect(164, 100, 208, 210, 22, 232, 134, 58);

// ── PNG encoding (zlib built-in, no npm packages) ────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

// ── ICO wrapping (PNG embedded — modern ICO format) ──────────────────────────
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type: ICO
icoHeader.writeUInt16LE(1, 4); // image count: 1

const dirEntry = Buffer.alloc(16);
dirEntry[0] = 0;  // width:  0 = 256
dirEntry[1] = 0;  // height: 0 = 256
dirEntry[2] = 0;  // colour count
dirEntry[3] = 0;  // reserved
dirEntry.writeUInt16LE(1,  4); // planes
dirEntry.writeUInt16LE(32, 6); // bit depth
dirEntry.writeUInt32LE(png.length, 8);
dirEntry.writeUInt32LE(22, 12); // offset: 6 + 16 = 22

const ico = Buffer.concat([icoHeader, dirEntry, png]);

const outPath = path.join(__dirname, '..', 'build', 'icon.ico');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, ico);
console.log('icon.ico written (' + (ico.length / 1024).toFixed(1) + ' KB)');
