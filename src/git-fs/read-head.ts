// ── git-fs read-head ──
//
// Parse `.git/HEAD` (or `.git/worktrees/<n>/HEAD`) into a
// GitHeadInfo without invoking git. HEAD is either:
//
//   ref: refs/heads/main      ← on a branch
//   a1b2c3d4...               ← detached at a 40-char SHA
//
// The ref path resolves to `.git/refs/heads/<branch>` OR an entry
// in `.git/packed-refs`. We check both so branches that were packed
// by `git gc` still resolve.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GitHeadInfo } from './types.js';
import type { LocatedGit } from './locate.js';

const SHA_RE = /^[0-9a-f]{40}$/i;

/** Read the HEAD for the located .git. Returns null on I/O error —
 *  caller treats that as "no git info" and moves on. */
export function readGitHead(located: LocatedGit): GitHeadInfo | null {
  const headPath = join(located.gitDir, 'HEAD');
  let raw: string;
  try {
    raw = readFileSync(headPath, 'utf8').trim();
  } catch {
    return null;
  }

  // Symbolic ref — `ref: refs/heads/<branch>` (or refs/tags, refs/*)
  const refMatch = raw.match(/^ref:\s*(.+)$/);
  if (refMatch) {
    const refPath = refMatch[1]!.trim();
    const branch = refPath.startsWith('refs/heads/')
      ? refPath.slice('refs/heads/'.length)
      : refPath; // tag / remote / arbitrary — surface verbatim
    const sha = resolveRefSha(located, refPath);
    return {
      gitDir: located.gitDir,
      commonGitDir: located.commonGitDir,
      isWorktree: located.isWorktree,
      branch: refPath.startsWith('refs/heads/') ? branch : null,
      sha,
      detached: !refPath.startsWith('refs/heads/'),
    };
  }

  // Direct SHA — detached HEAD.
  if (SHA_RE.test(raw)) {
    return {
      gitDir: located.gitDir,
      commonGitDir: located.commonGitDir,
      isWorktree: located.isWorktree,
      branch: null,
      sha: raw.toLowerCase(),
      detached: true,
    };
  }

  return null;
}

/** Resolve `refs/heads/<branch>` (or another ref) to a SHA. Tries
 *  the loose ref file first (`.git/refs/heads/<branch>`), then the
 *  packed-refs file. Returns null when neither source has the ref
 *  (legitimate for a branch that has no commits yet). */
function resolveRefSha(located: LocatedGit, refPath: string): string | null {
  const loose = join(located.commonGitDir, refPath);
  if (existsSync(loose)) {
    try {
      const sha = readFileSync(loose, 'utf8').trim();
      if (SHA_RE.test(sha)) return sha.toLowerCase();
    } catch { /* fall through to packed */ }
  }
  const packed = join(located.commonGitDir, 'packed-refs');
  try {
    const content = readFileSync(packed, 'utf8');
    for (const line of content.split('\n')) {
      // Skip comments, peeled-tag annotations, blank lines
      if (!line || line.startsWith('#') || line.startsWith('^')) continue;
      const [sha, name] = line.split(' ');
      if (name?.trim() === refPath && sha && SHA_RE.test(sha.trim())) {
        return sha.trim().toLowerCase();
      }
    }
  } catch { /* no packed-refs */ }
  return null;
}
