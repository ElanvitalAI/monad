// ── External tool detection (memoized `which`) ──
//
// Preview handlers shell out to pdftoppm / magick / ffmpegthumbnailer /
// 7z / bat / eza. Each lookup spawns a process, so we cache by name
// for the session. Returns the absolute path or null.
//
// Mirrors the implicit detection yazi gets via Cargo.toml deps — we
// can't link to them, so we discover them at runtime and degrade
// gracefully when absent.

import { spawnSync } from 'node:child_process';

const cache = new Map<string, string | null>();

export function whichSync(cmd: string): string | null {
  const hit = cache.get(cmd);
  if (hit !== undefined) return hit;
  let resolved: string | null = null;
  try {
    const res = spawnSync('which', [cmd], { encoding: 'utf8' });
    if (res.status === 0) {
      const line = res.stdout.trim();
      if (line.length > 0) resolved = line;
    }
  } catch { /* ignore */ }
  cache.set(cmd, resolved);
  return resolved;
}

export function has(cmd: string): boolean {
  return whichSync(cmd) !== null;
}

/** Test-only — reset the memoized lookups. */
export function _resetForTest(): void {
  cache.clear();
}
