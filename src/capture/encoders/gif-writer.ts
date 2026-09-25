// ── IUL Phase V·a — GIF89a writer (pure TypeScript, no deps) ──
//
// Sharp 0.34 cannot assemble animated GIF from raw frame buffers
// (`vips_image_get: field "n-pages" not found`); its animated input is
// only legal on already-multi-page formats. Rather than add a dep, this
// module ships a minimal GIF89a writer with:
//
//   - Web-safe 216-color palette + 40-step grayscale = 256 entries.
//     Quantization is "nearest in 6×6×6 cube" — fast, deterministic,
//     fine for terminal recordings whose color count is usually < 32.
//   - LZW image-data compression per the W3C GIF89a spec (variable
//     code length, clear/end codes, 255-byte sub-block framing).
//   - NETSCAPE 2.0 application extension for loop count.
//   - Per-frame Graphic Control Extension for delay (1/100s units).
//
// What it intentionally skips:
//   - Per-frame local palette (every frame uses the global palette)
//   - Floyd-Steinberg dithering (terminal output rarely needs it)
//   - Disposal method tuning (uses "no action" / 0)
//   - Alpha (treated as opaque after `ensureAlpha()`)

const PALETTE_SIZE = 256;
const GIF_LZW_MIN_CODE_SIZE = 8;
const NETSCAPE_HEADER = 'NETSCAPE2.0';

export interface GifWriteFrame {
  /** Raw RGBA pixels, length = width × height × 4. */
  readonly rgba: Buffer | Uint8Array;
  readonly delayMs: number;
}

export interface GifWriteOpts {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly GifWriteFrame[];
  readonly loop?: number;
}

export function writeAnimatedGif(opts: GifWriteOpts): Buffer {
  const { width, height, frames } = opts;
  if (frames.length === 0) throw new Error('writeAnimatedGif: no frames');
  const expectedLen = width * height * 4;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]!.rgba.length !== expectedLen) {
      throw new Error(
        `writeAnimatedGif: frame ${i} size ${frames[i]!.rgba.length} ` +
          `≠ expected ${expectedLen} (width=${width}, height=${height})`,
      );
    }
  }
  const palette = buildWebsafePalette();
  const out: number[] = [];
  writeHeader(out);
  writeLogicalScreenDescriptor(out, width, height);
  writeGlobalColorTable(out, palette);
  writeNetscapeLoopExt(out, opts.loop ?? 0);
  for (const frame of frames) {
    writeGraphicControlExt(out, Math.max(2, Math.round(frame.delayMs / 10)));
    writeImageDescriptor(out, width, height);
    const indices = quantize(frame.rgba, width, height);
    writeImageDataLZW(out, indices);
  }
  out.push(0x3b);                                           // GIF Trailer
  return Buffer.from(out);
}

// ── Palette (216-color web cube + 40-step grayscale) ─────────────

function buildWebsafePalette(): Uint8Array {
  const pal = new Uint8Array(PALETTE_SIZE * 3);
  let idx = 0;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        pal[idx++] = r * 51;
        pal[idx++] = g * 51;
        pal[idx++] = b * 51;
      }
    }
  }
  // Remaining 40 entries: even-spaced grayscale (excluding pure black/
  // white which already exist in the cube).
  for (let i = 0; i < 40; i++) {
    const v = Math.round(((i + 1) / 41) * 255);
    pal[idx++] = v; pal[idx++] = v; pal[idx++] = v;
  }
  return pal;
}

function quantize(rgba: Buffer | Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const ri = Math.min(5, Math.round(r / 51));
    const gi = Math.min(5, Math.round(g / 51));
    const bi = Math.min(5, Math.round(b / 51));
    out[i] = ri * 36 + gi * 6 + bi;
  }
  return out;
}

// ── GIF block writers (numbers pushed as bytes 0..255) ───────────

function u16le(out: number[], v: number): void {
  out.push(v & 0xff, (v >> 8) & 0xff);
}

function writeHeader(out: number[]): void {
  for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
}

function writeLogicalScreenDescriptor(out: number[], w: number, h: number): void {
  u16le(out, w);
  u16le(out, h);
  // Packed: GCT flag (1) | color resolution (7 → 0b111) | sort flag (0) |
  // GCT size (log2(256) - 1 = 7). Result: 0b1_111_0_111 = 0xf7.
  out.push(0xf7);
  out.push(0x00);                                           // background color index
  out.push(0x00);                                           // pixel aspect ratio
}

function writeGlobalColorTable(out: number[], palette: Uint8Array): void {
  for (let i = 0; i < palette.length; i++) out.push(palette[i]!);
}

function writeNetscapeLoopExt(out: number[], loop: number): void {
  out.push(0x21, 0xff, 0x0b);
  for (const ch of NETSCAPE_HEADER) out.push(ch.charCodeAt(0));
  out.push(0x03, 0x01);
  u16le(out, loop & 0xffff);
  out.push(0x00);
}

function writeGraphicControlExt(out: number[], delayCs: number): void {
  out.push(0x21, 0xf9, 0x04);
  // Packed: reserved(3) | disposal(3=0) | user input(0) | transparent(0) → 0
  out.push(0x00);
  u16le(out, delayCs);
  out.push(0x00);                                           // transparent color index
  out.push(0x00);                                           // block terminator
}

function writeImageDescriptor(out: number[], w: number, h: number): void {
  out.push(0x2c);
  u16le(out, 0);                                            // left
  u16le(out, 0);                                            // top
  u16le(out, w);
  u16le(out, h);
  out.push(0x00);                                           // no LCT, no interlace
}

// ── LZW image data ───────────────────────────────────────────────

function writeImageDataLZW(out: number[], indices: Uint8Array): void {
  out.push(GIF_LZW_MIN_CODE_SIZE);
  const lzw = lzwEncode(indices, GIF_LZW_MIN_CODE_SIZE);
  // Sub-block framing (max 255 bytes per block; 0 terminator).
  let pos = 0;
  while (pos < lzw.length) {
    const chunk = Math.min(255, lzw.length - pos);
    out.push(chunk);
    for (let i = 0; i < chunk; i++) out.push(lzw[pos + i]!);
    pos += chunk;
  }
  out.push(0x00);
}

function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const dict = new Map<string, number>();
  const initDict = (): void => {
    dict.clear();
    for (let i = 0; i < clearCode; i++) dict.set(String.fromCharCode(i), i);
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };

  const bytes: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;
  const emit = (code: number, size: number): void => {
    bitBuf |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  initDict();
  emit(clearCode, codeSize);
  let prefix = String.fromCharCode(indices[0]!);
  for (let i = 1; i < indices.length; i++) {
    const ch = String.fromCharCode(indices[i]!);
    const k = prefix + ch;
    if (dict.has(k)) {
      prefix = k;
    } else {
      emit(dict.get(prefix)!, codeSize);
      if (nextCode < 4096) {
        dict.set(k, nextCode++);
        if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        emit(clearCode, codeSize);
        initDict();
      }
      prefix = ch;
    }
  }
  emit(dict.get(prefix)!, codeSize);
  emit(eoiCode, codeSize);
  if (bitCount > 0) bytes.push(bitBuf & 0xff);
  return new Uint8Array(bytes);
}
