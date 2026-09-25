// ── git-fs types ──
//
// Shared across the git-fs module. Kept in one file so the public
// API surface is obvious from one import.

export interface GitHeadInfo {
  /** Absolute path to the "real" .git dir. For a worktree this is
   *  `<main>/.git/worktrees/<name>`; for the main checkout it is
   *  `<repo>/.git`. Caller uses this as the path to watch. */
  gitDir: string;
  /** The common git dir — same as gitDir for a main checkout;
   *  `<main>/.git` for a worktree. Used to read objects / config. */
  commonGitDir: string;
  /** True when the working directory is a secondary worktree (not
   *  the main checkout). */
  isWorktree: boolean;
  /** When HEAD points at a branch: the branch name ("main"). When
   *  HEAD is detached: null + `sha` is set. */
  branch: string | null;
  /** Current commit SHA (40 hex chars). null when no commits yet
   *  (fresh `git init` with no HEAD). */
  sha: string | null;
  /** True when HEAD is detached (no branch ref). */
  detached: boolean;
}

/** Dirty-file counts from `git status --porcelain`. All -1 if the
 *  probe failed (missing git / not a repo). */
export interface DirtyCount {
  modified: number;    // tracked + modified (M / A / D / R before staging)
  staged: number;      // staged (index changes)
  untracked: number;   // new files not tracked
  total: number;       // sum; 0 means clean
}

export const CLEAN_DIRTY: DirtyCount = { modified: 0, staged: 0, untracked: 0, total: 0 };

/** Upstream tracking counts: how many commits the current branch is
 *  ahead of / behind its upstream. Both zero when in sync; both null
 *  when no upstream is configured. */
export interface AheadBehind {
  ahead: number;
  behind: number;
}

/** Composite "what the status-bar wants". Branch comes from the
 *  cheap FS read; dirty + aheadBehind are cached subprocess results
 *  that arrive asynchronously. */
export interface GitStatusView {
  head: GitHeadInfo | null;     // null when cwd is outside any git repo
  dirty: DirtyCount | null;     // null before first probe
  aheadBehind: AheadBehind | null; // null when no upstream or not probed
  /** Epoch ms of last dirty probe. Throttling keys off this. */
  lastDirtyProbeAt: number;
}

export interface BranchRef {
  name: string;         // e.g. "main" / "feature/x"
  sha: string;          // 40-char hex
  isHead: boolean;      // true for the branch HEAD is on
  isRemote: boolean;    // true for refs under refs/remotes/...
}
