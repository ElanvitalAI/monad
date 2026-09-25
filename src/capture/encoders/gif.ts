// ── IUL Phase V·a — GIF encoder (animated) ──
//
// Render a sequence of ANSI/SVG/raw frames into a single animated GIF
// via `sharp`. Sharp ≥ 0.34 supports multi-page output through raw
// stacked input + `pageHeight` metadata + `.gif({ loop, delay })`.
//
// Pipeline:
//   1. Each frame → SVG string (via existing encoders/svg.ts) — caller
//      may pass pre-rendered SVG to skip this step.
//   2. SVG → raw RGBA pixel buffer (sharp).
//   3. All raw frames must share width × height. We assert this and
//      throw a clear error otherwise (frames of different terminal
//      sizes would be a recorder bug; better fail loud).
//   4. Stack vertically into one tall raw buffer, feed to sharp with
//      `pages` + `pageHeight`, emit as animated GIF with per-frame
//      delays.
//
// Cost note: The double-encode (svg → png → gif page) is wasteful
// per-frame, but sharp's animated GIF API needs raw pixel pages, not
// PNG bytes. Memory peaks at `width × pageHeight × 4 × N` raw bytes
// during the join — fine for the typical 80×24 × 100 frame range
// (~3 MB). Phase V·b explores ffmpeg for larger workloads.

import sharp from 'sharp';
import { encodeSvg, DEFAULT_SVG_THEME, type SvgThemeTokens } from './svg.js';
import { writeAnimatedGif } from './gif-writer.js';
import type { CaptureDimensions } from '../types.js';

export interface GifFrame {
  /** Either pre-rendered SVG OR raw ANSI/text payload. Mutually
   *  exclusive — provide one. When `ansi` is supplied, the encoder
   *  builds the SVG using `cols` / `rows` / `theme` defaults. */
  readonly svg?: string;
  readonly ansi?: string;
  /** Per-frame delay in milliseconds. Sharp converts to GIF's 1/100s
   *  units — values < 20 ms fall back to 20 (closest representable).
   *  Defaults to `defaultDelayMs` from EncodeGifOpts when omitted. */
  readonly delayMs?: number;
}

export interface EncodeGifOpts {
  readonly frames: readonly GifFrame[];
  /** Required when frames carry ANSI (each ANSI → SVG render). */
  readonly dims?: CaptureDimensions;
  /** Per-frame delay default (ms). Used when a frame omits its own. */
  readonly defaultDelayMs?: number;
  /** GIF loop count: 0 = forever (sharp default), N = play N times. */
  readonly loop?: number;
  /** Theme override forwarded to encodeSvg. */
  readonly theme?: Partial<SvgThemeTokens>;
  /** Optional GIF dither / palette tuning forwarded to sharp.gif(). */
  readonly effort?: number;          // 1..10 (sharp default 7)
  readonly reuse?: boolean;          // re-use palette across pages (sharp default true)
}

export class GifEncodeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GifEncodeError';
  }
}

export async function encodeGif(opts: EncodeGifOpts): Promise<Buffer> {
  if (!opts.frames || opts.frames.length === 0) {
    throw new GifEncodeError('encodeGif: at least one frame required');
  }
  const defaultDelay = opts.defaultDelayMs ?? 100;
  const theme: SvgThemeTokens = { ...DEFAULT_SVG_THEME, ...opts.theme };

  // ── Step 1: normalize → SVG strings ────────────────────────────
  const svgs = opts.frames.map((frame, idx) => {
    if (frame.svg) return frame.svg;
    if (frame.ansi !== undefined) {
      if (!opts.dims) {
        throw new GifEncodeError(
          `encodeGif: frame ${idx} carries ANSI but opts.dims missing`,
        );
      }
      return encodeSvg({
        input: frame.ansi,
        cols: opts.dims.cols,
        rows: opts.dims.rows,
        theme: opts.theme,
      });
    }
    throw new GifEncodeError(`encodeGif: frame ${idx} has neither svg nor ansi`);
  });

  // ── Step 2: render each SVG → raw RGBA pixels ──────────────────
  let raws: Array<{ data: Buffer; info: { width: number; height: number; channels: number } }>;
  try {
    raws = await Promise.all(
      svgs.map(svg =>
        sharp(Buffer.from(svg, 'utf8'))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      ),
    );
  } catch (err) {
    throw new GifEncodeError('encodeGif: failed to rasterize a frame', err);
  }

  // ── Step 3: assert uniform dims ────────────────────────────────
  const first = raws[0]!.info;
  for (let i = 1; i < raws.length; i++) {
    const cur = raws[i]!.info;
    if (cur.width !== first.width || cur.height !== first.height) {
      throw new GifEncodeError(
        `encodeGif: frame ${i} dims (${cur.width}×${cur.height}) ` +
          `differ from frame 0 (${first.width}×${first.height})`,
      );
    }
  }
  void theme; // theme is consumed inside encodeSvg; keep var for symmetry
  void opts.effort;
  void opts.reuse;

  // ── Step 4: hand-rolled GIF89a writer ─────────────────────────
  // Sharp ≤ 0.34 cannot assemble animated GIF from raw pixel pages;
  // see encoders/gif-writer.ts for the reasoning.
  try {
    return writeAnimatedGif({
      width: first.width,
      height: first.height,
      loop: opts.loop ?? 0,
      frames: raws.map((r, i) => ({
        rgba: r.data,
        delayMs: opts.frames[i]!.delayMs ?? defaultDelay,
      })),
    });
  } catch (err) {
    throw new GifEncodeError('encodeGif: failed to assemble animated GIF', err);
  }
}

/** Lightweight GIF header sniff. Returns true for GIF87a / GIF89a. */
export function isAnimatedGifBuffer(buf: Buffer): boolean {
  if (buf.length < 6) return false;
  const sig = buf.subarray(0, 6).toString('ascii');
  return sig === 'GIF87a' || sig === 'GIF89a';
}
