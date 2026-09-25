// ── Log retention (MSS M2.3) ──
//
// Age + size bounded cleanup for the `<cwd>/log/` directory owned by the
// `FileSink` in `src/debug/log.ts`. Runs once per process start via a
// `setImmediate` detach so startup is never blocked by the fs scan.
//
// Policy order: age filter first (delete anything older than `maxAgeDays`),
// then size filter (if the remaining footprint still exceeds
// `maxTotalMb`, delete oldest-first until it fits). Flags default to
// 30 days / 100 MiB — see `src/mss/feature-flags.ts`.
//
// The `FileSink` already handles per-file rotation (~10 MiB × 3 keep);
// this module complements that by preventing the **directory** from
// growing unbounded across long-running sessions or repeated invocations.
//
// Design invariants:
//   • Pure function of (dir, policy). `cleanupLogDir` takes the directory
//     as an argument so tests can drop mtime-manipulated fixtures into a
//     tmp dir without touching the real `<cwd>/log/`.
//   • Never throws. Unreadable entries and failed unlinks accumulate
//     into `RetentionResult.errors` and the caller decides what to do.
//   • Both knobs `0` ⇒ no-op. Matches the feature-flag opt-out path.
//   • Non-matching files (README.md, editor swap files) are ignored by
//     the default pattern.

import { readdirSync, statSync, unlinkSync, type Stats } from 'fs';
import { join } from 'path';

export interface RetentionPolicy {
  /** Delete files with `mtime` older than this many days. `0` disables. */
  maxAgeDays: number;
  /** When directory total exceeds this many MiB, delete oldest-first
   *  (by mtime) until it fits. `0` disables. */
  maxTotalMb: number;
  /** Filename filter. Defaults to `debug-*.log` including rotated
   *  variants like `debug-*.1.log`. */
  pattern?: RegExp;
}

export interface RetentionResult {
  /** Files matched by the pattern (before any deletion). */
  scanned: number;
  /** Files successfully unlinked. */
  deleted: number;
  /** Bytes reclaimed (sum of deleted file sizes at scan time). */
  reclaimedBytes: number;
  /** Non-fatal errors encountered during scan or unlink. One entry
   *  per failed operation. */
  errors: string[];
}

const DEFAULT_PATTERN = /^debug-.*\.log$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Entry {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Synchronous cleanup. Callers that care about startup latency wrap
 *  this in `setImmediate`. Both knobs `0` ⇒ return empty result
 *  without touching the filesystem. */
export function cleanupLogDir(
  dir: string,
  policy: Partial<RetentionPolicy> = {},
): RetentionResult {
  const maxAgeDays = policy.maxAgeDays ?? 0;
  const maxTotalMb = policy.maxTotalMb ?? 0;
  const pattern = policy.pattern ?? DEFAULT_PATTERN;
  const result: RetentionResult = {
    scanned: 0,
    deleted: 0,
    reclaimedBytes: 0,
    errors: [],
  };
  if (maxAgeDays <= 0 && maxTotalMb <= 0) return result;

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    result.errors.push(`readdir ${dir}: ${String(e)}`);
    return result;
  }

  const entries: Entry[] = [];
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const path = join(dir, name);
    let st: Stats;
    try {
      st = statSync(path);
    } catch (e) {
      result.errors.push(`stat ${name}: ${String(e)}`);
      continue;
    }
    if (!st.isFile()) continue;
    result.scanned += 1;
    entries.push({ path, size: st.size, mtimeMs: st.mtimeMs });
  }
  if (entries.length === 0) return result;

  // Age pass — deletes in-place (reverse iterate so splice is safe).
  if (maxAgeDays > 0) {
    const cutoff = Date.now() - maxAgeDays * MS_PER_DAY;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.mtimeMs >= cutoff) continue;
      try {
        unlinkSync(e.path);
        result.deleted += 1;
        result.reclaimedBytes += e.size;
        entries.splice(i, 1);
      } catch (err) {
        result.errors.push(`unlink ${e.path}: ${String(err)}`);
      }
    }
  }

  // Size pass — oldest-first until footprint fits.
  if (maxTotalMb > 0) {
    const maxBytes = maxTotalMb * 1024 * 1024;
    let total = entries.reduce((s, e) => s + e.size, 0);
    if (total > maxBytes) {
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const e of entries) {
        if (total <= maxBytes) break;
        try {
          unlinkSync(e.path);
          result.deleted += 1;
          result.reclaimedBytes += e.size;
          total -= e.size;
        } catch (err) {
          result.errors.push(`unlink ${e.path}: ${String(err)}`);
        }
      }
    }
  }

  return result;
}
