// ── git-fs dirty probe ──
//
// Runs `git status --porcelain` in the repo root and parses the
// one-line-per-file output. Subprocess cost is unavoidable — the
// kernel has to stat every tracked file vs its index entry.
//
// Throttle is enforced by the caller (the index.ts cache). This
// module just does one probe, synchronously (spawnSync), and is
// intentionally side-effect free.

import { spawnSync } from 'node:child_process';
import type { DirtyCount, AheadBehind } from './types.js';
import { CLEAN_DIRTY } from './types.js';

/** Shell out `git status --porcelain` and parse. Returns CLEAN_DIRTY
 *  on git-missing or non-repo. timeoutMs caps the subprocess — 5s
 *  matches codex's GIT_COMMAND_TIMEOUT. */
export function probeDirty(cwd: string, timeoutMs = 5_000): DirtyCount {
  const res = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (res.status !== 0 || res.error) return CLEAN_DIRTY;
  return parsePorcelain(res.stdout);
}

/** Parse porcelain v1 output. Format per line:
 *
 *     XY <path>               — regular change
 *     XY <old> -> <new>       — rename (X is 'R')
 *     ?? <path>               — untracked
 *
 *  X = index-vs-HEAD status (staged), Y = worktree-vs-index
 *  (modified). Counters key off those two characters independently
 *  so a staged-AND-modified file counts once in each bucket — that
 *  matches the user's mental model in the status pill ("3 staged,
 *  2 modified"). */
export function parsePorcelain(out: string): DirtyCount {
  let modified = 0;
  let staged = 0;
  let untracked = 0;
  for (const raw of out.split('\n')) {
    if (raw.length < 3) continue;
    const x = raw[0]!;
    const y = raw[1]!;
    if (x === '?' && y === '?') {
      untracked += 1;
      continue;
    }
    if (x !== ' ' && x !== '?') staged += 1;
    if (y !== ' ' && y !== '?') modified += 1;
  }
  return { modified, staged, untracked, total: modified + staged + untracked };
}

/** Ask git for ahead/behind counts relative to the upstream. Returns
 *  null when no upstream is configured. Cheap enough on small repos
 *  (~10-30ms) that we can run alongside the dirty probe. */
export function probeAheadBehind(cwd: string, timeoutMs = 5_000): AheadBehind | null {
  // @{u} resolves the configured upstream. When none, git exits 128.
  const res = spawnSync(
    'git',
    ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
    { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 },
  );
  if (res.status !== 0 || res.error) return null;
  const parts = res.stdout.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const behind = Number.parseInt(parts[0]!, 10);
  const ahead = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return null;
  return { ahead, behind };
}
