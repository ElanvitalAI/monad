// ── git-fs branches ──
//
// List local + remote branches via `git for-each-ref`. This is a
// subprocess — we hit it only when the user runs /branch, so hot-
// path cost is zero.

import { spawnSync } from 'node:child_process';
import { runGitCommand } from './runner.js';
import type { GitRunner } from './retry.js';
import type { BranchRef } from './types.js';
import type { GitHeadInfo } from './types.js';

export const DEFAULT_MERGED_BRANCH_BASE = 'origin/main';

export type MergedBranchLookup =
  | { ok: true; branches: ReadonlySet<string> }
  | { ok: false; branches: ReadonlySet<string> };

/** One `git branch --merged <base>` process. Callers hold the set and compare locally. */
export function listMergedBranches(
  cwd: string,
  base: string = DEFAULT_MERGED_BRANCH_BASE,
  runner?: GitRunner,
): MergedBranchLookup {
  const result = runGitCommand(cwd, ['branch', '--merged', base, '--format=%(refname:short)'], {}, runner);
  if (result.status !== 0) return { ok: false, branches: new Set() };
  const branches = new Set<string>();
  for (const raw of result.stdout.split('\n')) {
    const name = raw.trim();
    if (name) branches.add(name);
  }
  return { ok: true, branches };
}

/** Returns a flat list of BranchRef ordered by name within
 *  local-first, remote-last groups. Current branch (if any) has
 *  isHead = true. Empty array when git missing / not a repo. */
export function listBranches(
  cwd: string,
  head: GitHeadInfo | null,
  timeoutMs = 5_000,
): BranchRef[] {
  const res = spawnSync(
    'git',
    ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'],
    { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 },
  );
  if (res.status !== 0 || res.error) return [];

  const local: BranchRef[] = [];
  const remote: BranchRef[] = [];
  const currentBranch = head?.branch ?? null;

  for (const raw of res.stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [ref, sha] = line.split(/\s+/);
    if (!ref || !sha) continue;
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length);
      local.push({ name, sha, isHead: name === currentBranch, isRemote: false });
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length);
      // Skip the pseudo-ref `<remote>/HEAD` — it's not a branch.
      if (name.endsWith('/HEAD')) continue;
      remote.push({ name, sha, isHead: false, isRemote: true });
    }
  }
  local.sort((a, b) => a.name.localeCompare(b.name));
  remote.sort((a, b) => a.name.localeCompare(b.name));
  return [...local, ...remote];
}
