// Browser-pane LLM file summary — yazi-style `,s` chord.
//
// Reads the focused file (size-capped + binary-skipped), prompts an
// LLM for a short bullet summary, returns the accumulated text. Shows
// no UI itself — caller wires the popup. Pure module so it's testable
// without a dashboard.
//
// Mirrors the yazi plugin pattern from `yazi-plugin/preset/plugins/
// fzf.lua:11-35`: external command (here: streamLLM) with stdout
// captured into a notify popup. We don't need yazi's `ui.hide()`
// permit — streamLLM is a network call, not a TTY-grabbing process.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { LLMMessage } from '../llm.js';
import { streamLLM as defaultStreamLLM } from '../llm.js';

export const DEFAULT_SUMMARY_MAX_BYTES = 200_000;
const HARD_SIZE_CAP = DEFAULT_SUMMARY_MAX_BYTES * 5;   // 1 MB
const DEFAULT_MAX_TOKENS = 600;

/** Conservative binary-extension list. Keep small — false negatives
 *  surface as "garbled summary" which is recoverable; false positives
 *  silently lock out perfectly valid text formats which is annoying. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.ico',
  '.pdf', '.zip', '.gz', '.tgz', '.tar', '.bz2', '.xz', '.7z',
  '.mp3', '.mp4', '.mov', '.webm', '.ogg', '.wav', '.flac',
  '.wasm', '.so', '.dylib', '.dll', '.exe', '.o', '.a',
  '.class', '.jar', '.pyc', '.pyo',
  '.sqlite', '.db', '.bin', '.dat',
]);

export type SummarizeResult =
  | { ok: true; summary: string; sizeBytes: number; truncated: boolean }
  | { ok: false; reason: string };

export interface SummarizeFileDeps {
  /** Override fs read (tests). */
  readFile?: (absPath: string) => Promise<string>;
  /** Override fs stat (tests). */
  stat?: (absPath: string) => Promise<{ size: number }>;
  /** Override the LLM call (tests). Same shape as src/llm.ts streamLLM. */
  streamLLM?: typeof defaultStreamLLM;
}

export interface SummarizeFileOpts {
  /** Cap before truncation. Default 200 KB — large enough for most
   *  source files, small enough to keep token usage bounded. */
  maxBytes?: number;
  /** Override max-tokens for the LLM response. Default 600 — fits
   *  ~10 bullets comfortably. */
  maxTokens?: number;
  /** AbortSignal — propagates through to streamLLM via opts. */
  signal?: AbortSignal;
}

export function looksBinary(absPath: string): boolean {
  const ext = path.extname(absPath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

/** Pure summary helper. Returns the accumulated text or a typed
 *  failure object so the caller (dashboard chord runtime) can decide
 *  how to surface the failure to the user. */
export async function summarizeFileWithLLM(
  absPath: string,
  deps: SummarizeFileDeps = {},
  opts: SummarizeFileOpts = {},
): Promise<SummarizeResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_SUMMARY_MAX_BYTES;
  const stat = deps.stat ?? (async (p) => fs.stat(p));
  const readFile = deps.readFile ?? (async (p) => fs.readFile(p, 'utf-8'));
  const llm = deps.streamLLM ?? defaultStreamLLM;

  if (looksBinary(absPath)) {
    return { ok: false, reason: 'binary file — summary not supported' };
  }
  let stRes: { size: number };
  try {
    stRes = await stat(absPath);
  } catch (err) {
    return {
      ok: false,
      reason: `file not readable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (stRes.size > HARD_SIZE_CAP) {
    return {
      ok: false,
      reason: `file too large (${formatBytes(stRes.size)} > ${formatBytes(HARD_SIZE_CAP)})`,
    };
  }

  let raw: string;
  try {
    raw = await readFile(absPath);
  } catch (err) {
    return {
      ok: false,
      reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const truncated = raw.length > maxBytes;
  const slice = truncated ? raw.slice(0, maxBytes) + '\n[…truncated…]' : raw;

  const messages: LLMMessage[] = [
    {
      role: 'user',
      content:
        `Summarize the following file in 5–10 concise bullet points. ` +
        `Lead with the file's purpose in one line. Mention notable APIs, ` +
        `classes, functions, or sections. If the file is documentation, ` +
        `list the main sections. Use plain text bullets prefixed with "- ". ` +
        `No preamble, no closing sentence — just the bullets.\n\n` +
        `--- ${path.basename(absPath)} (${formatBytes(stRes.size)}` +
        `${truncated ? ', truncated' : ''}) ---\n` +
        slice,
    },
  ];

  const accum: string[] = [];
  try {
    await llm(
      messages,
      (delta: string) => { accum.push(delta); },
      { maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS },
    );
  } catch (err) {
    return {
      ok: false,
      reason: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    ok: true,
    summary: accum.join(''),
    sizeBytes: stRes.size,
    truncated,
  };
}
