/**
 * Generates the extension icons.
 *
 * The icons are produced rather than committed as binaries so that the artwork is
 * reviewable, reproducible, and trivially adjustable. A minimal PNG encoder is used:
 * the images are tiny and flat, so a full imaging dependency would be disproportionate.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zlibSync } from 'fflate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

const BACKGROUND = [0x1f, 0x23, 0x28, 0xff];
const CODE_LINE = [0x8b, 0x94, 0x9e, 0xff];
const COVERED = [0x3f, 0xb9, 0x50, 0xff];
const PARTIAL = [0xd2, 0x99, 0x22, 0xff];
const UNCOVERED = [0xf8, 0x51, 0x49, 0xff];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
}

function encodePng(size, pixels) {
  return encodePng2(size, size, pixels);
}

/** Encodes non-square images too, which the promotional tile needs. */
function encodePng2(width, height, pixels) {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }

  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

function draw(size) {
  const pixels = new Uint8Array(size * size * 4);
  const set = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    pixels.set(colour, (y * size + x) * 4);
  };

  const radius = Math.max(1, Math.round(size * 0.18));
  const inside = (x, y) => {
    // Rounded-rectangle mask, so the icon does not look like a raw square at 128px.
    const cx = Math.min(x, size - 1 - x);
    const cy = Math.min(y, size - 1 - y);
    if (cx >= radius || cy >= radius) {
      return true;
    }
    const dx = radius - cx;
    const dy = radius - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inside(x, y)) {
        set(x, y, BACKGROUND);
      }
    }
  }

  // Coverage bar down the left edge, split into covered / partial / uncovered.
  const barWidth = Math.max(2, Math.round(size * 0.16));
  const barLeft = Math.max(1, Math.round(size * 0.13));
  const third = size / 3;

  for (let y = 0; y < size; y++) {
    if (!inside(barLeft, y)) {
      continue;
    }
    const colour = y < third ? COVERED : y < third * 2 ? PARTIAL : UNCOVERED;
    for (let x = barLeft; x < barLeft + barWidth; x++) {
      set(x, y, colour);
    }
  }

  // Suggestion of code to the right of the bar.
  const textLeft = barLeft + barWidth + Math.max(1, Math.round(size * 0.09));
  const lineHeight = Math.max(1, Math.round(size * 0.09));
  const gap = Math.max(2, Math.round(size * 0.19));
  const widths = [0.62, 0.44, 0.55];

  for (let index = 0; index < widths.length; index++) {
    const top = Math.round(size * 0.22 + index * gap);
    const width = Math.round((size - textLeft) * widths[index]);
    for (let y = top; y < top + lineHeight; y++) {
      for (let x = textLeft; x < textLeft + width; x++) {
        if (inside(x, y)) {
          set(x, y, CODE_LINE);
        }
      }
    }
  }

  return pixels;
}

mkdirSync(join(ROOT, 'assets'), { recursive: true });

for (const size of SIZES) {
  const png = encodePng(size, draw(size));
  writeFileSync(join(ROOT, 'assets', `icon-${size}.png`), png);
  console.log(`assets/icon-${size}.png (${png.length} bytes)`);
}

/**
 * Small promotional tile, 440x280.
 *
 * The Chrome Web Store requires this before a listing can be published, and its guidance
 * is explicit: communicate the brand rather than showing a screenshot, avoid text, fill
 * the region, and keep the edges well defined. So this is the gutter motif — the three
 * coverage states beside suggested code — scaled up, and nothing else.
 */
function drawPromo(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  const set = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    pixels.set(colour, (y * width + x) * 4);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      set(x, y, BACKGROUND);
    }
  }

  // Coverage bars down the left, one band per state.
  const barLeft = Math.round(width * 0.11);
  const barWidth = Math.round(width * 0.035);
  const bands = [COVERED, COVERED, PARTIAL, COVERED, UNCOVERED, COVERED, PARTIAL, UNCOVERED];
  const rowHeight = Math.round(height * 0.075);
  const top = Math.round((height - bands.length * rowHeight) / 2);

  for (let index = 0; index < bands.length; index++) {
    const rowTop = top + index * rowHeight;
    for (let y = rowTop; y < rowTop + rowHeight - 4; y++) {
      for (let x = barLeft; x < barLeft + barWidth; x++) {
        set(x, y, bands[index]);
      }
    }

    // A suggestion of code beside each bar, with a stable pseudo-random length so the
    // tile looks like source without carrying any text.
    const codeLeft = barLeft + barWidth + Math.round(width * 0.04);
    const widths = [0.62, 0.44, 0.55, 0.7, 0.38, 0.5, 0.66, 0.42];
    const codeWidth = Math.round((width - codeLeft - width * 0.1) * widths[index]);
    const codeTop = rowTop + Math.round(rowHeight * 0.28);
    for (let y = codeTop; y < codeTop + Math.max(3, Math.round(rowHeight * 0.34)); y++) {
      for (let x = codeLeft; x < codeLeft + codeWidth; x++) {
        set(x, y, CODE_LINE);
      }
    }
  }

  return pixels;
}

const promo = encodePng2(440, 280, drawPromo(440, 280));
mkdirSync(join(ROOT, 'docs', 'store'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'store', 'promo-440x280.png'), promo);
console.log(`docs/store/promo-440x280.png (${promo.length} bytes)`);
