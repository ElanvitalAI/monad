// Reusable output truncation + saved-path spillover.
//
// When a tool produces a large output, sending the full body to the
// LLM both burns tokens and blows the context window. The shortlist
// (Tier A3) calls for a single helper that:
//   1. Returns the body as-is when ≤ threshold (fast path).
//   2. Writes the full body to /tmp/elanous-output/<hash>.<ext>.
//   3. Returns a truncated head + tail with a "saved to:" footer
//      so the model knows it can read more via the Read tool.
//
// Used by api_call (P9), mermaid_render (P8), pty_shell_poll (P14)
// and any future tool with potentially large output.
//
// Hash-based filename: deterministic over (tool name, body content)
// so a re-run with identical output reuses the same file (cheap to
// confirm via stat). Files are NOT auto-deleted — the OS reaps /tmp
// on reboot, which is the right granularity for "transient debugging
// artifacts the model might re-read".

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { createHash } from 'node:crypto';

export const DEFAULT_OUTPUT_DIR = process.env.ELANOUS_OUTPUT_DIR
  ?? joinPath(tmpdir(), 'elanous-output');

export const DEFAULT_INLINE_LIMIT = 8 * 1024;     // 8 KB inline
export const DEFAULT_HEAD_BYTES = 4 * 1024;       // 4 KB head when spilled
export const DEFAULT_TAIL_BYTES = 2 * 1024;       // 2 KB tail when spilled

export interface TruncateOptions {
  /** Tool name — included in the saved-path filename + hash for
   *  attribution. */
  toolName: string;
  /** File extension for the spilled file (no leading dot). Default 'txt'. */
  ext?: string;
  /** Bytes above which we spill. Default 8192. */
  inlineLimit?: number;
  /** Head bytes preserved when spilled. Default 4096. */
  headBytes?: number;
  /** Tail bytes preserved when spilled. Default 2048. */
  tailBytes?: number;
  /** Override the output directory (test seam). */
  outputDir?: string;
}

export interface TruncateResult {
  /** What to send to the LLM: original body OR head+tail+"saved to" footer. */
  output: string;
  /** Was the body spilled to disk? */
  spilled: boolean;
  /** Absolute path of the saved file when spilled, undefined otherwise. */
  savedPath?: string;
  /** Total bytes of the original body. */
  originalBytes: number;
}

/** Apply head/tail truncation + optional disk spill. */
export function truncateOutput(body: string, opts: TruncateOptions): TruncateResult {
  const inlineLimit = opts.inlineLimit ?? DEFAULT_INLINE_LIMIT;
  const head = opts.headBytes ?? DEFAULT_HEAD_BYTES;
  const tail = opts.tailBytes ?? DEFAULT_TAIL_BYTES;
  const ext = (opts.ext ?? 'txt').replace(/^\./, '');
  const outputDir = opts.outputDir ?? DEFAULT_OUTPUT_DIR;

  const bytes = Buffer.byteLength(body, 'utf-8');
  if (bytes <= inlineLimit) {
    return { output: body, spilled: false, originalBytes: bytes };
  }

  // Spill.
  const hash = createHash('sha1').update(opts.toolName).update('\u0000').update(body).digest('hex').slice(0, 12);
  const filename = `${opts.toolName}-${hash}.${ext}`;
  const savedPath = joinPath(outputDir, filename);

  if (!existsSync(savedPath)) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(savedPath, body, 'utf-8');
  }

  // Build head+tail+footer. Slice on the string (not bytes) for
  // simplicity; cap is a hint, not an invariant. UTF-8 multi-byte
  // boundaries don't matter because we feed it to the LLM, not a
  // byte-stream consumer.
  const headStr = body.slice(0, head);
  const tailStr = body.slice(-tail);
  const elided = bytes - headStr.length - tailStr.length;
  const out = [
    headStr,
    `\n\n[... ${elided} bytes elided — saved to ${savedPath} (${bytes} bytes total). ` +
      `Use Read tool with file_path="${savedPath}" to inspect more. ...]\n\n`,
    tailStr,
  ].join('');

  return { output: out, spilled: true, savedPath, originalBytes: bytes };
}

/** Test seam — list spilled files for assertions. */
export function listSpilledFilesForTesting(outputDir: string): string[] {
  if (!existsSync(outputDir)) return [];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readdirSync(outputDir);
}
