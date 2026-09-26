// ── git-fs locate ──
//
// Walk up from a cwd to find the .git directory (or .git file for a
// worktree). No subprocess — just stat() + readFile().
//
// Ported conceptually from claude-code-fork/src/utils/git/gitFilesystem
// + codex-rs/git-utils/src/info.rs::resolve_root_git_project_for_trust.
// The elanous version only needs the paths; trust enforcement lives
// elsewhere.

import { existsSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';

export interface LocatedGit {
  /** The directory the caller started from (abs). */
  from: string;
  /** Repo root — the parent of the .git entry. For a worktree this
   *  is the secondary checkout root; for the main checkout this is
   *  the repo root. */
  root: string;
  /** Resolved path to the real .git directory for THIS working
   *  copy. Worktree: `<main>/.git/worktrees/<name>`. Main: `<repo>/.git`. */
  gitDir: string;
  /** Common git dir — same as gitDir for main, `<main>/.git` for a
   *  worktree. This is where `refs/heads/*` / `packed-refs` / config
   *  live. */
  commonGitDir: string;
  /** True when the `.git` entry at root is a file (worktree) rather
   *  than a directory (main checkout). */
  isWorktree: boolean;
}

/** Find the git dir by walking up from `start`. Returns null when
 *  the path is not inside any git repo or access fails. Caller is
 *  expected to cache — this does not memoize. */
export function findGitDir(start: string): LocatedGit | null {
  let cur = resolve(start);
  // Cap the walk at 40 levels so a pathological symlink loop / very
  // long path doesn't hang. 40 > any realistic project depth.
  for (let i = 0; i < 40; i++) {
    const candidate = join(cur, '.git');
    try {
      const st = statSync(candidate);
      if (st.isDirectory()) {
        return {
          from: resolve(start),
          root: cur,
          gitDir: candidate,
          commonGitDir: candidate,
          isWorktree: false,
        };
      }
      if (st.isFile()) {
        // Worktree: the file contains "gitdir: /abs/path" pointing
        // at <main>/.git/worktrees/<name>.
        const content = readFileSync(candidate, 'utf8').trim();
        const match = content.match(/^gitdir:\s*(.+)$/m);
        if (!match) {
          // Malformed .git file — treat as no-repo rather than
          // throw; the user can see the file themselves.
          return null;
        }
        const rawGitDir = match[1]!.trim();
        const abs = isAbsolute(rawGitDir) ? rawGitDir : resolve(cur, rawGitDir);
        const gitDir = existsSync(abs) ? realpathSync(abs) : abs;
        const commonGitDir = readCommonDirPointer(gitDir);
        return {
          from: resolve(start),
          root: cur,
          gitDir,
          commonGitDir,
          isWorktree: true,
        };
      }
    } catch {
      // ENOENT here is normal — keep walking up.
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/** For a secondary worktree, `<gitDir>/commondir` points back to
 *  the main repo's .git dir. Returns gitDir itself when the
 *  commondir pointer is missing (main checkout). */
function readCommonDirPointer(gitDir: string): string {
  const commondirFile = join(gitDir, 'commondir');
  try {
    const content = readFileSync(commondirFile, 'utf8').trim();
    if (!content) return gitDir;
    const abs = isAbsolute(content) ? content : resolve(gitDir, content);
    return existsSync(abs) ? realpathSync(abs) : abs;
  } catch {
    return gitDir;
  }
}
