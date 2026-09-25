// ── Capture Phase 0 — asciicast v2 encoder ──
//
// Format reference: https://docs.asciinema.org/manual/asciicast/v2/
//
// Layout:
//   Line 1 : JSON header object
//            {"version":2,"width":W,"height":H,"timestamp":T,"title":"…","env":{…}}
//   Line N : JSON array frame
//            [timeSec, "o"|"i", "chunk"]
//
// Each line ends with '\n'. Trailing newline after the last frame is
// standard in asciinema output so we honor that convention here.
//
// Phase 0 keeps chunk strings unmodified (no ANSI strip) — asciicast
// is meant to preserve the exact output that was emitted, SGR and all.
// Callers that want plain text should consume the text encoder
// separately.

import type { CaptureDimensions, RecorderStream } from '../types.js';

export interface AsciicastHeader {
  readonly width: number;
  readonly height: number;
  /** Epoch seconds. */
  readonly timestamp: number;
  readonly title?: string;
  readonly env?: Record<string, string>;
}

export interface AsciicastFrame {
  /** Seconds since start of recording. */
  readonly time: number;
  readonly stream: RecorderStream;
  readonly data: string;
}

/** Build the header JSON. Separate from the frame encoder so tests
 *  can assert the header shape independently. */
export function asciicastHeader(h: AsciicastHeader): string {
  const body: Record<string, unknown> = {
    version: 2,
    width: h.width,
    height: h.height,
    timestamp: Math.max(0, Math.floor(h.timestamp)),
  };
  if (h.title !== undefined) body.title = h.title;
  if (h.env !== undefined && Object.keys(h.env).length > 0) body.env = h.env;
  return JSON.stringify(body);
}

/** Encode a single frame line. Time is rounded to microseconds
 *  because the asciinema cli expresses frames with 6-decimal precision;
 *  mirroring that keeps diffs cleaner. */
export function asciicastFrame(f: AsciicastFrame): string {
  const t = Math.max(0, Math.round(f.time * 1_000_000) / 1_000_000);
  return JSON.stringify([t, f.stream, f.data]);
}

/** Full asciicast v2 document from a header + frames. Lines joined
 *  with '\n' and terminated by a final '\n' to match asciinema's on-
 *  disk form. */
export function encodeAsciicast(opts: {
  readonly dims: CaptureDimensions;
  readonly startedAtSec: number;
  readonly title?: string;
  readonly env?: Record<string, string>;
  readonly frames: readonly AsciicastFrame[];
}): string {
  const headerOpts: AsciicastHeader = {
    width: opts.dims.cols,
    height: opts.dims.rows,
    timestamp: opts.startedAtSec,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  };
  const lines = [asciicastHeader(headerOpts)];
  for (const f of opts.frames) lines.push(asciicastFrame(f));
  return lines.join('\n') + '\n';
}

/** Parse an asciicast v2 string back into {header, frames}. Tolerant
 *  of trailing whitespace and blank lines. Kept minimal — throws on
 *  malformed content so tests can lock in the round-trip invariant. */
export function decodeAsciicast(raw: string): {
  header: AsciicastHeader;
  frames: AsciicastFrame[];
} {
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error('asciicast empty');
  }
  const header = JSON.parse(lines[0]!) as Record<string, unknown>;
  if (header.version !== 2) {
    throw new Error(`asciicast version must be 2 (got ${String(header.version)})`);
  }
  const out: AsciicastHeader = {
    width: Number(header.width),
    height: Number(header.height),
    timestamp: Number(header.timestamp),
    ...(typeof header.title === 'string' ? { title: header.title } : {}),
    ...(header.env && typeof header.env === 'object'
      ? { env: header.env as Record<string, string> }
      : {}),
  };
  const frames: AsciicastFrame[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parsed = JSON.parse(lines[i]!) as unknown[];
    if (!Array.isArray(parsed) || parsed.length !== 3) {
      throw new Error(`invalid frame at line ${i + 1}`);
    }
    const [time, stream, data] = parsed;
    if (typeof time !== 'number' || typeof data !== 'string'
        || (stream !== 'o' && stream !== 'i')) {
      throw new Error(`invalid frame shape at line ${i + 1}`);
    }
    frames.push({ time, stream, data });
  }
  return { header: out, frames };
}
