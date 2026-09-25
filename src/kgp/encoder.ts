// ── Kitty Graphics Protocol encoder ──
//
// Port of yazi-adapter/src/drivers/kgp.rs:346-398. Produces three
// byte streams for a single image:
//
//   1. uploadSequence()     → APC transmit, `a=T`, unicode placeholders.
//      Chunked base64 at 4096 chars per APC; `m=1` continuation until
//      the last chunk uses `m=0`.
//   2. placeholderGrid()    → printable Unicode region that renders
//      the image at (rows × cols) cells. Safe to embed in normal
//      pane paint because it's just a sequence of text + SGR fg.
//   3. deleteSequence()     → APC delete-by-id to erase a previous
//      image before drawing a new one in the same pane slot.
//
// tmux passthrough wrapping lives in wrapForTmux(); off by default
// because Phase 1 assumes a non-tmux host.

import { DIACRITICS, PLACEHOLDER, DIACRITIC_COUNT } from './diacritics.js';

export interface ImageFrame {
  /** Raw pixel buffer. Must match `format`. */
  data: Uint8Array;
  /** Pixel width of the image buffer. */
  w: number;
  /** Pixel height of the image buffer. */
  h: number;
  /** Colour format — 24 = RGB (3 B/px), 32 = RGBA (4 B/px). */
  format: 24 | 32;
  /** KGP image id — 24-bit, unique per displayed image. Row-diacritic
   *  encoding only uses the low 24 bits, so callers derive this via
   *  `hash(path + mtime) & 0xFFFFFF` — collisions across concurrent
   *  images cause cross-talk, so keep the id stable+unique. */
  imageId: number;
}

export interface PlacementOpts {
  rows: number;
  cols: number;
  imageId: number;
}

// Chunk size per APC (kgp.rs:350). Kitty spec allows up to 4096 base64
// chars per chunk; exceed this and the terminal rejects the stream.
const CHUNK_SIZE = 4096;

/** Encode one image as a list of APC `_G…\x1b\\` sequences. Caller is
 *  expected to write them in order. Return value is a single string —
 *  easier to pipe through `process.stdout.write()` in one go which
 *  also minimises interleaving with unrelated TUI frame output. */
export function uploadSequence(frame: ImageFrame): string {
  const b64 = base64Encode(frame.data);
  const chunks = chunkify(b64, CHUNK_SIZE);
  if (chunks.length === 0) return '';

  let out = '';
  const first = chunks[0];
  const more = chunks.length > 1 ? 1 : 0;
  // a=T       transmit+display
  // C=1       no cursor move after display
  // U=1       unicode-placeholder mode (pairs with placeholderGrid())
  // q=2       quiet — terminal must not respond
  // f={24|32} pixel format: RGB or RGBA
  // s,v       pixel width, height
  // i=id      image id for later delete / reuse
  // m=0|1     more-chunks flag (follow-up sequences only carry `m=` + data)
  out += `\x1b_Gq=2,a=T,C=1,U=1,f=${frame.format},s=${frame.w},v=${frame.h},i=${frame.imageId},m=${more};${first}\x1b\\`;

  for (let i = 1; i < chunks.length; i++) {
    const hasMore = i < chunks.length - 1 ? 1 : 0;
    out += `\x1b_Gm=${hasMore};${chunks[i]}\x1b\\`;
  }
  return out;
}

/** Emit a printable Unicode grid of `rows × cols` placeholder cells.
 *  Each row is a separate string — preview-pane renderers typically
 *  paint line-by-line, and KGP's placeholder markers don't advance
 *  the cursor across rows on their own. Callers prepend padding to
 *  align the grid to the pane's inner rect (SGR cursor positioning
 *  is the pane's responsibility; see yazi's `place()` at kgp.rs:383
 *  which uses CSI CUP because yazi draws via crossterm). */
export function placeholderGrid({ rows, cols, imageId }: PlacementOpts): string[] {
  if (rows <= 0 || cols <= 0) return [];

  const r = (imageId >> 16) & 0xFF;
  const g = (imageId >> 8) & 0xFF;
  const b = imageId & 0xFF;
  // SGR 38;2;r;g;b — truecolor fg. Yazi piggybacks the image id onto
  // the foreground colour bytes; Kitty's placeholder parser reads
  // those bytes to match the id on upload. `0` resets back to the
  // pane's normal colour at the end of each row so the following
  // line isn't tinted with the image id.
  const FG_ON  = `\x1b[38;2;${r};${g};${b}m`;
  const FG_OFF = `\x1b[39m`;

  const out: string[] = new Array(rows);
  const yMax = Math.min(rows, DIACRITIC_COUNT);
  const xMax = Math.min(cols, DIACRITIC_COUNT);

  for (let y = 0; y < yMax; y++) {
    const rowDia = DIACRITICS[y];
    let line = FG_ON;
    for (let x = 0; x < xMax; x++) {
      line += PLACEHOLDER + rowDia + DIACRITICS[x];
    }
    line += FG_OFF;
    out[y] = line;
  }
  // Caller asked for more rows than we have diacritics (unlikely —
  // images this tall would exceed the terminal anyway). Pad with
  // blank lines so the caller's line count lines up with their
  // expectation; they'll never see visible content past row 296.
  for (let y = yMax; y < rows; y++) out[y] = '';
  return out;
}

/** `\x1b_Gq=2,a=d,d=I,i=<id>\x1b\\` — delete an image by id. Use this
 *  before drawing a new image over the same pane region to avoid the
 *  new image's placeholder cells picking up stale pixels from the
 *  previous id (they don't, because each cell carries its own id in
 *  the fg colour — but Kitty's cache fills with orphan images over a
 *  long session, so explicit delete keeps memory bounded). */
export function deleteSequence(imageId: number): string {
  return `\x1b_Gq=2,a=d,d=I,i=${imageId}\x1b\\`;
}

/** Bulk clear all KGP images. Useful at dashboard exit or between
 *  preview-modal stacks to guarantee a clean slate. */
export function deleteAllSequence(): string {
  return `\x1b_Gq=2,a=d,d=A\x1b\\`;
}

// ── helpers ──

function chunkify(s: string, n: number): string[] {
  if (s.length <= n) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

function base64Encode(data: Uint8Array): string {
  // Bun/Node both ship a Buffer shim; using it keeps this dep-free.
  // Fallback path (`btoa` + binary string) is slower and blows the
  // string stack for large buffers — only used if Buffer isn't
  // available (test environments).
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  // btoa handles only Latin-1 — our bin construction is Latin-1 by codepoint.
  return btoa(bin);
}

/** Wrap a sequence for tmux passthrough. Inactive until Phase 4 —
 *  exported now so the pipeline's interface shape is stable. */
export function wrapForTmux(seq: string): string {
  const esc = '\x1b\x1b';
  const start = '\x1bPtmux;';
  const close = '\x1b\\';
  return start + seq.replace(/\x1b/g, esc) + close;
}
