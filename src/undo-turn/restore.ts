// ── undo-turn: restore ──
//
// Given a Snapshot, restore the working tree to match the snapshot's
// captured state. Port of codex's restore_ghost_commit_with_options:
//
//   git cat-file -e <sha>              verify commit still exists
//                                      (may have been gc'd after a
//                                      long delay)
//   git restore --source <sha>         overwrite working tree from
//     --worktree -- .                  snapshot tree. NOT reset
//                                      --mixed: index is preserved
//                                      so `git add -p` work survives
//   delete untracked added since       compare current untracked
//                                      set to snap.untrackedFiles
//
// A failed restore returns a structured result — caller surfaces it
// as a chat-log warning without throwing.

import { rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findGitDir } from '../git-fs/locate.js';
import { runGitCommand } from '../git-fs/runner.js';
import type { Snapshot, RestoreResult } from './types.js';

export function restoreSnapshot(snap: Snapshot): RestoreResult {
  // Worktree-aware guard: reject if the user has moved to a different
  // repo since the snapshot was taken. Same-repo secondary-worktree
  // case is still blocked because that's a different `root`.
  const loc = findGitDir(snap.repoRoot);
  if (!loc || resolve(loc.root) !== resolve(snap.repoRoot)) {
    return {
      ok: false, untrackedRemoved: 0,
      summary: 'refused restore',
      error: `repo root has changed since snapshot was taken; refusing to restore into a different working copy (${snap.repoRoot})`,
    };
  }

  // Verify commit still lives. Anything that ran `git gc` between
  // snapshot and restore can have collected our orphan.
  const exists = runGitCommand(snap.repoRoot, ['cat-file', '-e', snap.sha], {
    stdio: 'pipe', timeout: 5_000,
  });
  if (exists.status !== 0) {
    return {
      ok: false, untrackedRemoved: 0,
      summary: 'snapshot missing',
      error: `snapshot commit ${snap.sha.slice(0, 7)} no longer exists — it may have been gc'd. Run /undo list to see what's still available.`,
    };
  }

  // git restore --source <sha> --worktree -- <path>
  //   • overwrites working tree with the tree of <sha>
  //   • leaves the index untouched (preserves `git add -p` work)
  //   • does NOT remove files that are in the working tree but not
  //     in the snapshot tree — we handle untracked separately below
  const restoreRes = runGitCommand(
    snap.repoRoot, ['restore', '--source', snap.sha, '--worktree', '--', '.'],
    { encoding: 'utf8', timeout: 60_000 },
  );
  if (restoreRes.status !== 0) {
    const stderr = (restoreRes.stderr || '').trim() || `exit ${restoreRes.status}`;
    return {
      ok: false, untrackedRemoved: 0,
      summary: 'git restore failed',
      error: stderr,
    };
  }

  // Delete new untracked files — those that exist now but didn't
  // exist at snapshot time. Directories containing only new
  // untracked files are caught implicitly when the last file inside
  // is removed. We deliberately do NOT rmdir empty dirs — the user
  // may have created them on purpose.
  const preExisting = new Set(snap.untrackedFiles);
  const currentUntracked = listUntrackedNow(snap.repoRoot);
  let untrackedRemoved = 0;
  for (const rel of currentUntracked) {
    if (preExisting.has(rel)) continue;
    const abs = join(snap.repoRoot, rel);
    try {
      const st = statSync(abs);
      if (st.isFile() || st.isSymbolicLink()) {
        rmSync(abs, { force: true });
        untrackedRemoved += 1;
      }
    } catch { /* already gone — count stays */ }
  }

  const shortSha = snap.sha.slice(0, 7);
  return {
    ok: true,
    untrackedRemoved,
    summary: `restored ${shortSha}${untrackedRemoved > 0 ? ` (cleared ${untrackedRemoved} new untracked file${untrackedRemoved === 1 ? '' : 's'})` : ''}`,
  };
}

function listUntrackedNow(repoRoot: string): string[] {
  const res = runGitCommand(
    repoRoot, ['ls-files', '-o', '--exclude-standard', '-z'],
    { encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (res.status !== 0) return [];
  return res.stdout.split('\0').filter(Boolean);
}
