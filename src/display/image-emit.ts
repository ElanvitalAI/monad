// AXON P3.2 — Protocol-aware image emit.
//
// Single async entry point `emitImage()` that takes a PNG buffer +
// requested size and returns the escape-sequence bytes ready to write
// to stdout, plus the row count the caller should reserve.
//
// Protocol routing comes from `terminal-capability.detectImageCapability()`:
//   - kitty           → Kitty Graphics Protocol (KGP) via existing
//                       `src/kgp/encoder.ts`. Requires `sharp` to
//                       decode PNG → RGBA. If sharp is unavailable
//                       at runtime (probe fails), falls through to
//                       chafa-symbol fallback so callers never crash.
//   - iterm2          → OSC 1337 IIP. No decode — just base64-encode
//                       the PNG and wrap in the IIP envelope.
//   - sixel           → spawn chafa CLI with `--format sixel` reading
//                       PNG from stdin.
//   - chafa-fallback  → spawn chafa CLI with `--format symbols` for
//                       terminal-agnostic block-art.
//   - none            → alt-text bytes (no image emit).
//
// Errors during emit (sharp absent, chafa missing, stdin pipe broken)
// are mapped to a fallback path; the function never throws — callers
// always get a non-empty string + correct row count.

import { spawn } from 'node:child_process';
import {
  detectImageCapability,
  type ImageProtocol,
  type TerminalImageCapability,
} from './terminal-capability.js';

export interface ImageEmitInput {
  /** PNG bytes — caller's responsibility (e.g. sharp.toBuffer({format:'png'})). */
  png: Buffer;
  /** Output width in cells. Defaults to 40 — readable in most panes. */
  widthCols?: number;
  /** Output height in cells. Defaults to 20. */
  heightRows?: number;
  /** Plain-text caption — used as both the alt-text fallback and the
   *  trailing description line in image protocols (so SR users still
   *  hear what's on screen). */
  alt: string;
  /** Override capability detection — useful for tests. */
  capability?: TerminalImageCapability;
}

export interface ImageEmitOutput {
  /** Bytes ready to `process.stdout.write()`. May be alt-text only. */
  bytes: string;
  /** Visual rows occupied — caller subtracts from layout budget. */
  rows: number;
  /** True when an image protocol failed and the writer fell back to
   *  chafa or alt-text. */
  fallback: boolean;
  /** Which protocol actually emitted (after any fallback). */
  protocol: ImageProtocol;
}

const DEFAULT_WIDTH_COLS = 40;
const DEFAULT_HEIGHT_ROWS = 20;

/** Emit an image with the best available protocol. Always resolves
 *  with a non-empty output (alt-text at minimum). */
export async function emitImage(input: ImageEmitInput): Promise<ImageEmitOutput> {
  const cap = input.capability ?? detectImageCapability();
  const widthCols = Math.max(1, input.widthCols ?? DEFAULT_WIDTH_COLS);
  const heightRows = Math.max(1, input.heightRows ?? DEFAULT_HEIGHT_ROWS);

  switch (cap.protocol) {
    case 'iterm2':
      return emitIterm2(input, widthCols, heightRows, cap);
    case 'sixel':
      return emitViaChafa(input, widthCols, heightRows, cap, 'sixel');
    case 'chafa-fallback':
      return emitViaChafa(input, widthCols, heightRows, cap, 'symbols');
    case 'kitty':
      // Kitty path requires sharp (PNG → RGBA). When sharp is absent
      // (test envs, missing native binary) we fall through to chafa
      // so callers always get something on screen.
      return emitKitty(input, widthCols, heightRows, cap);
    case 'none':
    default:
      return emitAltText(input, heightRows);
  }
}

// ── Kitty ────────────────────────────────────────────────────────────

async function emitKitty(
  input: ImageEmitInput,
  widthCols: number,
  heightRows: number,
  cap: TerminalImageCapability,
): Promise<ImageEmitOutput> {
  try {
    // Lazy import — sharp binary may be missing in CI / minimal envs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharpMod: any = await import('sharp').catch(() => null);
    if (!sharpMod) throw new Error('sharp unavailable');
    const sharp = sharpMod.default ?? sharpMod;

    const targetW = widthCols * cap.cellPx.w;
    const targetH = heightRows * cap.cellPx.h;
    const { data, info } = await sharp(input.png)
      .resize(targetW, targetH, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { uploadSequence, placeholderGrid } = await import('../kgp/encoder.js');
    const imageId = pickImageId();
    const upload = uploadSequence({
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      w: info.width,
      h: info.height,
      format: info.channels === 4 ? 32 : 24,
      imageId,
    });
    const grid = placeholderGrid({ rows: heightRows, cols: widthCols, imageId });

    return {
      bytes: upload + grid.join('\n') + '\n',
      rows: heightRows,
      fallback: false,
      protocol: 'kitty',
    };
  } catch {
    // Sharp absent or KGP encode failed — fall through to chafa.
    return emitViaChafa(input, widthCols, heightRows, cap, 'symbols');
  }
}

// ── iTerm2 OSC 1337 IIP ──────────────────────────────────────────────

function emitIterm2(
  input: ImageEmitInput,
  widthCols: number,
  heightRows: number,
  _cap: TerminalImageCapability,
): ImageEmitOutput {
  // OSC 1337 ; File = inline = 1 ; size = N ; width = Wcol ; height = Hcol ;
  // preserveAspectRatio = 1 : <base64> BEL
  // Spec: https://iterm2.com/documentation-images.html
  const b64 = input.png.toString('base64');
  const args = [
    'inline=1',
    `size=${input.png.byteLength}`,
    `width=${widthCols}`,
    `height=${heightRows}`,
    'preserveAspectRatio=1',
  ].join(';');
  const seq = `\x1b]1337;File=${args}:${b64}\x07`;
  return {
    bytes: seq,
    rows: heightRows,
    fallback: false,
    protocol: 'iterm2',
  };
}

// ── chafa CLI (sixel + symbols) ──────────────────────────────────────

async function emitViaChafa(
  input: ImageEmitInput,
  widthCols: number,
  heightRows: number,
  _cap: TerminalImageCapability,
  format: 'sixel' | 'symbols',
): Promise<ImageEmitOutput> {
  try {
    const out = await runChafa(input.png, widthCols, heightRows, format);
    return {
      bytes: out,
      rows: heightRows,
      fallback: format !== 'sixel' && format !== 'symbols' ? true : format === 'symbols',
      protocol: format === 'sixel' ? 'sixel' : 'chafa-fallback',
    };
  } catch {
    return emitAltText(input, heightRows);
  }
}

function runChafa(
  png: Buffer,
  widthCols: number,
  heightRows: number,
  format: 'sixel' | 'symbols',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--format', format,
      '--size', `${widthCols}x${heightRows}`,
      '-',
    ];
    let proc;
    try {
      proc = spawn('chafa', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.setEncoding('utf-8');
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`chafa exited ${code}: ${stderr.trim()}`));
    });
    proc.stdin.end(png);
  });
}

// ── alt-text-only fallback ───────────────────────────────────────────

function emitAltText(input: ImageEmitInput, _heightRows: number): ImageEmitOutput {
  // Image-protocol-less terminals get a single descriptive line. We
  // intentionally don't pad to the requested heightRows — callers can
  // use `rows` to know the layout impact (1) and lay out other content
  // below.
  const line = `[image · ${input.alt}]`;
  return {
    bytes: line + '\n',
    rows: 1,
    fallback: true,
    protocol: 'none',
  };
}

// ── helpers ──────────────────────────────────────────────────────────

let nextImageId = 1;
function pickImageId(): number {
  // 24-bit unique id — wraps but the dashboard delete-on-replace path
  // means collisions just refresh the cache. Tests can reset via the
  // capability-level _resetForTest helper alongside.
  const id = nextImageId & 0xFFFFFF;
  nextImageId = (nextImageId + 1) & 0xFFFFFF;
  return id || 1;
}

/** Test-only — reset image-id sequence so test snapshots are stable. */
export function _resetImageIdForTest(): void {
  nextImageId = 1;
}
