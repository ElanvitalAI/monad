// ── undo-turn: capture ──
//
// Port of codex-rs/core/src/ghost_commits.rs — writes a detached
// commit into .git/objects containing the full working-tree state
// (tracked + untracked, optional ignored). No ref, so `git log` /
// `git log --all` / `reflog` are untouched. `git gc` WILL eventually
// reclaim the commit; that's acceptable — the LLM's safety window
// is measured in turns, not weeks.
//
// Pipeline (exact codex sequence):
//
//   1. Resolve HEAD (may be absent in a fresh repo → we skip)
//   2. Spawn with GIT_INDEX_FILE=<tmp> throughout so the user's real
//      index is never touched:
//        git read-tree HEAD                 # seed temp index
//        git ls-files -o --exclude-standard # for untracked enumeration
//        git add --all -- .                 # stage tracked + untracked
//        git write-tree                     # → tree SHA
//   3. `git commit-tree <tree> -p HEAD -m "elanous snapshot"` with a
//      pinned author identity so snapshots don't impersonate the user.
//      Returns a 40-char SHA. That's our snapshot id (plus a short id
//      for UX).

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { findGitDir } from '../git-fs/locate.js';
import { runGitCommand } from '../git-fs/runner.js';
import type { Snapshot, CaptureOpts } from './types.js';

const DEFAULT_LARGE_UNTRACKED_BYTES = 10 * 1024 * 1024;
const SNAPSHOT_MESSAGE_PREFIX = 'elanous snapshot';

/** Best-effort snapshot. Returns null on any failure — caller treats
 *  that as "no safety net for this turn" and proceeds without an
 *  error modal (the user's main flow must not break because git
 *  hiccuped). */
export function captureSnapshot(cwd: string, opts: CaptureOpts = {}): Snapshot | null {
  const loc = findGitDir(cwd);
  if (!loc) return null;
  const repoRoot = resolve(loc.root);

  const parentSha = resolveHead(repoRoot);

  // codex skips the snapshot entirely when there's no HEAD — the
  // working tree has nothing to "restore back to", and `git
  // commit-tree` with no -p works but produces an orphan parent-less
  // commit. We allow that: the user still gets a turn-undo.
  const untracked = listUntracked(repoRoot, opts);

  const tmpIdxDir = mkdtempSync(join(tmpdir(), 'elanous-snap-idx-'));
  const tmpIdx = join(tmpIdxDir, 'index');
  try {
    const env = { ...process.env, GIT_INDEX_FILE: tmpIdx };

    // Seed the temp index from HEAD so deletions show up in the
    // snapshot tree. Skipped in fresh-repo path.
    if (parentSha) {
      const readTree = runGitCommand(repoRoot, ['read-tree', parentSha], {
        env, stdio: 'pipe',
      });
      if (readTree.status !== 0) return null;
    }

    const addArgs = ['add'];
    if (opts.includeIgnored) addArgs.push('--force');
    addArgs.push('--all', '--', '.');
    const addRes = runGitCommand(repoRoot, addArgs, {
      env, encoding: 'utf8',
      timeout: 60_000,
    });
    if (addRes.status !== 0) return null;

    const treeRes = runGitCommand(repoRoot, ['write-tree'], {
      env, encoding: 'utf8', timeout: 30_000,
    });
    if (treeRes.status !== 0) return null;
    const treeSha = treeRes.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(treeSha)) return null;

    const commitArgs = ['commit-tree', treeSha];
    if (parentSha) commitArgs.push('-p', parentSha);
    const message = opts.description
      ? `${SNAPSHOT_MESSAGE_PREFIX} — ${opts.description}`
      : SNAPSHOT_MESSAGE_PREFIX;
    commitArgs.push('-m', message);
    const commitRes = runGitCommand(repoRoot, commitArgs, {
      encoding: 'utf8', timeout: 30_000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Elanous Snapshot',
        GIT_AUTHOR_EMAIL: 'snapshot@elanous.local',
        GIT_COMMITTER_NAME: 'Elanous Snapshot',
        GIT_COMMITTER_EMAIL: 'snapshot@elanous.local',
      },
    });
    if (commitRes.status !== 0) return null;
    const sha = commitRes.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(sha)) return null;

    return {
      id: shortId(),
      sha,
      parentSha,
      repoRoot,
      gitDir: loc.gitDir,
      untrackedFiles: untracked,
      capturedAt: Date.now(),
      description: opts.description,
    };
  } finally {
    try { rmSync(tmpIdxDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

function resolveHead(repoRoot: string): string | null {
  const result = runGitCommand(repoRoot, ['rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
  });
  const out = result.stdout.trim();
  return result.status === 0 && /^[0-9a-f]{40}$/i.test(out) ? out.toLowerCase() : null;
}

function listUntracked(repoRoot: string, opts: CaptureOpts): string[] {
  const args = ['ls-files', '-o', '--exclude-standard', '-z'];
  if (opts.includeIgnored) args.splice(3, 0, '--ignored');
  const res = runGitCommand(repoRoot, args, {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (res.status !== 0) return [];
  const files = res.stdout.split('\0').filter(Boolean);
  if (opts.includeLargeUntracked) return files;
  return files.filter(rel => {
    try {
      const st = statSync(join(repoRoot, rel));
      return st.isFile() && st.size <= DEFAULT_LARGE_UNTRACKED_BYTES;
    } catch {
      return false;
    }
  });
}

function shortId(): string {
  return randomBytes(4).toString('hex');
}
