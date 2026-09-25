// PLAN-ipad-notes-obsidian-typora R1·c (2026-05-17) —
// Orphan-note cleanup probe.
//
// iPad CodeMirror auto-save creates a vault file as soon as the user
// switches to a fresh "+ Type" buffer. If the user backs out without
// typing anything, that file becomes a 0-byte (or whitespace-only)
// orphan polluting the vault. This probe enumerates such candidates
// so a UI sweep can offer "delete N empty drafts" — destructive
// action is gated on the user, never auto-fired.
//
// Heuristic (intentionally conservative):
//   - file is `.md`
//   - file is older than `minAgeMs` (default 5 min — auto-save
//     debounce + a buffer)
//   - body (post-frontmatter strip) is empty or whitespace-only
//   - body is shorter than `minBodyBytes` (default 8 — covers
//     "# untitled\n" templates)
//
// The probe is read-only — it returns paths + ages + sizes, never
// deletes. iPad iOS surfaces a "Cleanup N orphans" sheet with
// individual confirm gates (matches the destructive-role convention
// the rest of the cascade follows).

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface OrphanCandidate {
  relPath: string;
  ageMs: number;
  size: number;
  /** First 80 chars of the body post-frontmatter (UI preview). */
  preview: string;
}

export interface CleanupOrphansResult {
  orphans: OrphanCandidate[];
  /** Total .md walked (informational — UI shows "scanned N files"). */
  scanned: number;
  /** True when the walk hit `walkCap` and aborted. */
  truncated: boolean;
  error?: string;
}

export interface CleanupOrphansOpts {
  vaultRoot: string;
  /** Files newer than `now - minAgeMs` are skipped (still being edited).
   *  Default 5 min = 5 * 60 * 1000 ms. */
  minAgeMs?: number;
  /** Files larger than this byte threshold are skipped (have content).
   *  Default 8 = covers `# untitled\n` + nothing else. */
  minBodyBytes?: number;
  /** Cap on returned candidates. Default 200. */
  limit?: number;
  /** Cap on .md files walked. Default 5000 (matches poll-changes). */
  walkCap?: number;
  /** Wall-clock seam (test). Defaults to Date.now. */
  now?: () => number;
  /** Override fs reads (test). */
  readFileFn?: (path: string) => Promise<string>;
}

const DEFAULT_MIN_AGE_MS = 5 * 60 * 1000;
// Default 20 — covers `# untitled\n` template (11 chars) + a single
// stray word the user may have typed before backing out. Higher
// caps would start flagging real-but-short notes; lower caps would
// miss the most common "# untitled" auto-save residue.
const DEFAULT_MIN_BODY_BYTES = 20;
const DEFAULT_LIMIT = 200;
const DEFAULT_WALK_CAP = 5000;
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '.obsidian', '.trash']);

/** Strip a leading YAML frontmatter block (`---\n…\n---\n`) so the
 *  emptiness check measures actual body content, not the auto-added
 *  `source: camera-intake`/etc preamble notes-save tacks on. */
function stripFrontmatter(s: string): string {
  if (!s.startsWith('---\n') && !s.startsWith('---\r\n')) return s;
  const newlinePattern = /\r?\n/;
  const lines = s.split(newlinePattern);
  // Find the closing `---` (skip the first one at index 0).
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { endIdx = i; break; }
  }
  if (endIdx < 0) return s;
  return lines.slice(endIdx + 1).join('\n');
}

export async function findOrphanNotes(opts: CleanupOrphansOpts): Promise<CleanupOrphansResult> {
  const minAgeMs = opts.minAgeMs != null && opts.minAgeMs >= 0
    ? Math.floor(opts.minAgeMs)
    : DEFAULT_MIN_AGE_MS;
  const minBodyBytes = opts.minBodyBytes != null && opts.minBodyBytes >= 0
    ? Math.floor(opts.minBodyBytes)
    : DEFAULT_MIN_BODY_BYTES;
  const limit = opts.limit != null && opts.limit > 0
    ? Math.min(Math.floor(opts.limit), 5000)
    : DEFAULT_LIMIT;
  const walkCap = opts.walkCap != null && opts.walkCap > 0
    ? Math.floor(opts.walkCap)
    : DEFAULT_WALK_CAP;
  const now = opts.now ?? Date.now;
  const read = opts.readFileFn ?? ((p: string) => readFile(p, 'utf8'));
  const cutoff = now() - minAgeMs;

  const orphans: OrphanCandidate[] = [];
  const state = { scanned: 0, truncated: false };

  async function walk(dir: string, relPrefix: string): Promise<void> {
    if (state.truncated || orphans.length >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (relPrefix === '') throw e;
      return;
    }
    for (const e of entries) {
      if (state.truncated || orphans.length >= limit) return;
      if (e.name.startsWith('.') || SKIP_DIR_NAMES.has(e.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(join(dir, e.name), rel);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        state.scanned++;
        if (state.scanned > walkCap) {
          state.truncated = true;
          return;
        }
        try {
          const s = await stat(join(dir, e.name));
          if (s.mtimeMs > cutoff) continue; // still recent
          if (s.size > 8192) continue;       // big file = not orphan
          const raw = await read(join(dir, e.name));
          const body = stripFrontmatter(raw).trim();
          if (body.length > minBodyBytes) continue;
          orphans.push({
            relPath: rel,
            ageMs: now() - s.mtimeMs,
            size: s.size,
            preview: body.slice(0, 80),
          });
        } catch {
          // Per-file failures (permission · vanished · transient EIO)
          // skip silently — the probe is best-effort and the user can
          // re-run.
        }
      }
    }
  }

  try {
    await walk(opts.vaultRoot, '');
    // Oldest first so the UI presents "5 day old empty draft" before
    // "6 min old empty draft" — slight bias toward stable cleanup
    // candidates over ones the user may still come back to.
    orphans.sort((a, b) => b.ageMs - a.ageMs);
    return { orphans, scanned: state.scanned, truncated: state.truncated };
  } catch (e) {
    return {
      orphans: [],
      scanned: 0,
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
