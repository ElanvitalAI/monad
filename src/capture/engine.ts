// ── Capture Phase 0 — engine entry ──
//
// Single `capture(req)` entry. The caller supplies the raw payload via
// `req.source()` and chooses a format; the engine dispatches to an
// encoder and returns the artifact plus metadata.
//
// Phase 0 intentionally keeps the engine dumb: no source registry, no
// pane substrate lookup, no sharp/SVG pipeline. Those arrive in Phase
// 2b (substrate integration) and Phase 0.5 (SVG/PNG), respectively.
//
// See: 내부 문서 `PLAN-session-capture-phase-0` §2.2

import { encodeAnsi } from './encoders/ansi.js';
import { encodeAsciicast } from './encoders/asciicast.js';
import { svgToPng, type SvgToPngOpts } from './encoders/png.js';
import { encodeSvg } from './encoders/svg.js';
import { encodeText } from './encoders/text.js';
import type { CaptureRequest, CaptureResult } from './types.js';

export interface CaptureImageResult extends CaptureResult {
  /** PNG (or other binary) bytes. For non-png formats this is the
   *  UTF-8 encoding of `body` — callers can pick either field. */
  readonly bodyBytes: Buffer;
}

export function capture(req: CaptureRequest): CaptureResult {
  const now = (req.now ?? Date.now)();
  const input = req.source();
  const body = encodeFormat(req, input, now);
  const result: CaptureResult = {
    format: req.format,
    body,
    bytes: byteLen(body),
    dims: req.dims,
    capturedAt: now,
    ...(req.title !== undefined ? { title: req.title } : {}),
    ...(req.echoInput === true ? { input } : {}),
  };
  return result;
}

function encodeFormat(req: CaptureRequest, input: string, now: number): string {
  switch (req.format) {
    case 'text':
      return encodeText(input);
    case 'ansi':
      return encodeAnsi(input);
    case 'asciicast':
      // A single-frame asciicast where the whole input lands at t=0.
      // The recorder (recorder.ts) is the right entry for live stream
      // capture; this path is "serialize one snapshot as a valid
      // 1-frame cast" so diffable artifacts stay uniform.
      return encodeAsciicast({
        dims: req.dims,
        startedAtSec: Math.floor(now / 1000),
        ...(req.title !== undefined ? { title: req.title } : {}),
        frames: [{ time: 0, stream: 'o', data: input }],
      });
    case 'svg':
      return encodeSvg({
        input,
        cols: req.dims.cols,
        rows: req.dims.rows,
        ...(req.title !== undefined ? { title: req.title } : {}),
        ...(req.theme !== undefined ? { theme: req.theme as never } : {}),
      });
    case 'png':
      // PNG requires SVG → rasterization which is async-only (sharp).
      // Route callers to the async `captureImage()` entry instead.
      throw new Error(
        'capture: png format requires captureImage() — use encodeSvg + svgToPng directly',
      );
    default: {
      const exhaustive: never = req.format;
      throw new Error(`capture: unsupported format ${String(exhaustive)}`);
    }
  }
}

function byteLen(s: string): number {
  // Node-friendly: Bun ships Buffer too.
  return Buffer.byteLength(s, 'utf8');
}

/** Async variant that handles PNG via sharp. For text/ansi/asciicast/svg
 *  the body is the same string as sync capture(); for 'png' the body is
 *  an empty string and the bytes are returned via `bodyBytes`. Callers
 *  should branch on `format` to read the right field. */
export async function captureImage(
  req: CaptureRequest,
  pngOpts: SvgToPngOpts = {},
): Promise<CaptureImageResult> {
  const now = (req.now ?? Date.now)();
  if (req.format !== 'png') {
    // Reuse the sync path; bodyBytes is just the UTF-8 encoding of body.
    const sync = capture(req);
    return { ...sync, bodyBytes: Buffer.from(sync.body, 'utf8') };
  }
  const input = req.source();
  const svg = encodeSvg({
    input,
    cols: req.dims.cols,
    rows: req.dims.rows,
    ...(req.title !== undefined ? { title: req.title } : {}),
    ...(req.theme !== undefined ? { theme: req.theme as never } : {}),
  });
  const png = await svgToPng(svg, pngOpts);
  return {
    format: 'png',
    body: '',
    bodyBytes: png,
    bytes: png.byteLength,
    dims: req.dims,
    capturedAt: now,
    ...(req.title !== undefined ? { title: req.title } : {}),
    ...(req.echoInput === true ? { input } : {}),
  };
}
