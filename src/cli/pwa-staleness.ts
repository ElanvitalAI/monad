// PWA staleness check — decides whether `apps/pwa/out/` reflects the
// current source tree, so `elanous nexus run` (static mode) can auto-build
// when the user has pulled new commits / edited source.
//
// The comparison is mtime-based:
//   newest(`apps/pwa/{src,public,next.config.*,package.json}`) > newest(`apps/pwa/out/<artifact>`)
//
// → considered stale, triggers a one-shot `runPwaBuild` before start.
//
// We intentionally walk a fixed set of "source" entry points instead of
// the whole apps/pwa tree because `apps/pwa/.next/` and `apps/pwa/out/`
// themselves get touched by every build, which would cause an infinite
// "always stale" loop. `node_modules` is excluded for the same speed +
// noise reasons.

import { existsSync, statSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

const SOURCE_DIRS = ['src', 'public'] as const;
const SOURCE_FILES = [
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'package.json',
  'postcss.config.mjs',
  'tsconfig.json',
] as const;

/** Walk a directory recursively and return the latest mtime (ms epoch)
 *  of any file under it. Returns 0 when the dir doesn't exist or is
 *  empty. Used for both the source-side and the out-side comparison. */
export function latestMtimeInDir(dir: string, opts?: { skip?: ReadonlySet<string> }): number {
  if (!existsSync(dir)) return 0;
  const skip = opts?.skip ?? new Set<string>();
  let latest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true }) as Dirent[];
    } catch {
      continue; // permission / race — skip
    }
    for (const ent of entries) {
      if (skip.has(ent.name)) continue;
      const full = join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        try {
          const m = statSync(full).mtimeMs;
          if (m > latest) latest = m;
        } catch {
          /* gone between readdir + stat */
        }
      }
    }
  }
  return latest;
}

/** Newest mtime across all source entry points (dirs + top-level config
 *  files) under `apps/pwa/`. Returns 0 when none of them exist. */
export function latestSourceMtime(pwaCwd: string): number {
  let latest = 0;
  for (const d of SOURCE_DIRS) {
    const m = latestMtimeInDir(join(pwaCwd, d));
    if (m > latest) latest = m;
  }
  for (const f of SOURCE_FILES) {
    const path = join(pwaCwd, f);
    if (!existsSync(path)) continue;
    try {
      const m = statSync(path).mtimeMs;
      if (m > latest) latest = m;
    } catch {
      /* race */
    }
  }
  return latest;
}

/** Newest mtime across the `apps/pwa/out/` build artifact tree. Returns
 *  0 when `out/` doesn't exist — which we treat as "definitely stale,
 *  needs a first build". */
export function latestOutMtime(pwaCwd: string): number {
  return latestMtimeInDir(join(pwaCwd, 'out'));
}

export interface StalenessVerdict {
  stale: boolean;
  reason: 'out-missing' | 'source-newer' | 'fresh';
  sourceMtime: number;
  outMtime: number;
}

/** Compare source-side vs out-side mtimes and emit a verdict the caller
 *  can use to decide whether to auto-build before starting nexus. */
export function checkPwaStaleness(pwaCwd: string): StalenessVerdict {
  const sourceMtime = latestSourceMtime(pwaCwd);
  const outMtime = latestOutMtime(pwaCwd);
  if (outMtime === 0) {
    return { stale: true, reason: 'out-missing', sourceMtime, outMtime };
  }
  if (sourceMtime > outMtime) {
    return { stale: true, reason: 'source-newer', sourceMtime, outMtime };
  }
  return { stale: false, reason: 'fresh', sourceMtime, outMtime };
}
