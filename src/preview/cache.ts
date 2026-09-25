// ── Preview cache — disk-backed thumbnail store ──
//
// Mirrors yazi's `ya.file_cache(job)` (yazi-plugin/src/utils/cache.rs).
// Key = hash(absPath + mtime + skip). Phase A doesn't write anything
// yet (text/image handlers render on demand); the file exists so
// Phase B (pdf/video/svg) can compute cache paths without another
// round of design.
//
// Location: $XDG_CACHE_HOME/monad-agent/preview or ~/.cache/monad-agent/preview
// — shared across worktrees on the same machine.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = (() => {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
  return join(base, 'monad-agent', 'preview');
})();

let ensured = false;
function ensureRoot(): void {
  if (ensured) return;
  try { mkdirSync(ROOT, { recursive: true }); } catch { /* ignore */ }
  ensured = true;
}

export function cacheRoot(): string {
  ensureRoot();
  return ROOT;
}

/** Deterministic cache path for `absPath` at `skip` offset (PDF page,
 *  video timestamp, etc.). Does NOT create the file — callers spawn
 *  their converter and write to this path. `ext` defaults to `.jpg`
 *  since most thumbnail producers emit JPEG. */
export function cachePathFor(absPath: string, skip: number = 0, ext: string = '.jpg'): string {
  ensureRoot();
  let mtime = 0;
  try { mtime = Math.floor(statSync(absPath).mtimeMs); } catch { /* best effort */ }
  const h = createHash('sha256');
  h.update(absPath);
  h.update('\0');
  h.update(String(mtime));
  h.update('\0');
  h.update(String(skip));
  const hex = h.digest('hex').slice(0, 32);
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  return join(ROOT, `${hex}${normalizedExt}`);
}

export function cacheHas(path: string): boolean {
  return existsSync(path);
}

/** Bump mtime so GC (run elsewhere) treats it as recently accessed.
 *  Best-effort — silent on failure since cache is expendable. */
export function cacheTouch(path: string): void {
  try {
    const now = new Date();
    utimesSync(path, now, now);
  } catch { /* ignore */ }
}

/** Delete cache files whose mtime is older than `maxAgeMs`. Returns
 *  the number of files removed. Best-effort — never throws. Intended
 *  to run once at session start (dashboard init) or on a coarse
 *  interval. Default keeps 7 days. */
export function cacheGc(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
  ensureRoot();
  let removed = 0;
  let entries: string[] = [];
  try { entries = readdirSync(ROOT); } catch { return 0; }
  const threshold = Date.now() - maxAgeMs;
  for (const name of entries) {
    const p = join(ROOT, name);
    try {
      const s = statSync(p);
      if (!s.isFile()) continue;
      if (s.mtimeMs < threshold) {
        unlinkSync(p);
        removed++;
      }
    } catch { /* skip individual failures */ }
  }
  return removed;
}
