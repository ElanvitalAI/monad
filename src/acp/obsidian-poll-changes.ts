// PLAN-ipad-notes-obsidian-typora §5 Phase O4·6 (2026-05-17) —
// Vault external-change probe. Returns the number of `.md` files
// (and a small sample of paths) that have been modified since the
// caller-supplied `sinceMs` epoch. iPad Notes polls this every
// ~30 s so a user editing the same vault from desktop Obsidian (or
// `obsidian-headless` Sync pulling remote edits) sees a "Reload"
// indicator without manually refreshing.
//
// Cheap-by-design: only stat the file, no read. Skips hidden dirs
// (`.obsidian`, `.git`, `.trash`) and `node_modules`. Sample paths
// capped at `samplePathCap` (default 10) so a noisy vault doesn't
// ship megabytes of strings on each poll.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface PollChangesResult {
  /** Total count of `.md` files modified since `sinceMs`. */
  count: number;
  /** Up to `samplePathCap` of those paths (vault-relative). Useful for
   *  a "newly-changed: foo.md, bar.md, …" UI hint. */
  samplePaths: string[];
  /** Most-recent mtime seen during this poll (epoch ms). Caller stores
   *  this as the next call's `sinceMs` so polls are monotonic — no risk
   *  of missing a change that lands during the same poll window. */
  latestMtimeMs: number;
  error?: string;
}

export interface PollChangesOpts {
  vaultRoot: string;
  /** Epoch ms cutoff — files with mtime > sinceMs are counted. Use 0
   *  on the first call to get the absolute latest mtime in the vault. */
  sinceMs: number;
  /** Cap on samplePaths array. Default 10. */
  samplePathCap?: number;
  /** Walk-budget. Stop walking after this many files have been stat'd
   *  (returns truncated result). Default 5000 — enough for ~99% of
   *  vaults but bounded so a huge attachments dir doesn't stall iOS. */
  walkCap?: number;
}

const DEFAULT_SAMPLE_CAP = 10;
const DEFAULT_WALK_CAP = 5000;
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '.obsidian', '.trash']);

export async function pollVaultChanges(opts: PollChangesOpts): Promise<PollChangesResult> {
  const sampleCap = opts.samplePathCap && opts.samplePathCap > 0
    ? Math.floor(opts.samplePathCap)
    : DEFAULT_SAMPLE_CAP;
  const walkCap = opts.walkCap && opts.walkCap > 0
    ? Math.floor(opts.walkCap)
    : DEFAULT_WALK_CAP;
  const sinceMs = typeof opts.sinceMs === 'number' && opts.sinceMs >= 0
    ? opts.sinceMs
    : 0;

  const state = {
    count: 0,
    samplePaths: [] as string[],
    latestMtimeMs: sinceMs,
    walked: 0,
    aborted: false,
  };

  async function walk(dir: string, relPrefix: string): Promise<void> {
    if (state.aborted) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (relPrefix === '') throw e;
      return;
    }
    for (const e of entries) {
      if (state.aborted) return;
      if (e.name.startsWith('.') || SKIP_DIR_NAMES.has(e.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(join(dir, e.name), rel);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        state.walked++;
        if (state.walked > walkCap) {
          state.aborted = true;
          return;
        }
        try {
          const s = await stat(join(dir, e.name));
          const mtimeMs = s.mtimeMs;
          if (mtimeMs > state.latestMtimeMs) state.latestMtimeMs = mtimeMs;
          if (mtimeMs > sinceMs) {
            state.count++;
            if (state.samplePaths.length < sampleCap) {
              state.samplePaths.push(rel);
            }
          }
        } catch {
          // Silently skip files we can't stat — the indicator stays
          // correct enough for everything else.
        }
      }
    }
  }

  try {
    await walk(opts.vaultRoot, '');
    return {
      count: state.count,
      samplePaths: state.samplePaths,
      latestMtimeMs: state.latestMtimeMs,
    };
  } catch (e) {
    return {
      count: 0,
      samplePaths: [],
      latestMtimeMs: sinceMs,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
