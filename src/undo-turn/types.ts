// ── undo-turn types ──
//
// Shared across the module. A Snapshot is identified by its 40-char
// commit SHA; the short `id` is UX-only (greppable in chat logs).

export interface Snapshot {
  /** 8-char hex — human-readable tag used by /undo <id>. */
  id: string;
  /** 40-char git commit SHA living in .git/objects. No ref points
   *  at it, so `git log` / `git log --all` / reflog stay clean. */
  sha: string;
  /** HEAD SHA at snapshot time. null in a fresh repo (no commits yet). */
  parentSha: string | null;
  /** Absolute repo root where the snapshot was captured. Restore
   *  verifies this to refuse cross-worktree restores. */
  repoRoot: string;
  /** Resolved .git dir (for worktrees: secondary, not commondir).
   *  Used only for diagnostics today. */
  gitDir: string;
  /** Untracked files (paths relative to repoRoot) that existed at
   *  snapshot time. Restore deletes every CURRENT untracked file
   *  not in this set — i.e., removes new junk LLM may have created. */
  untrackedFiles: string[];
  /** Epoch ms. */
  capturedAt: number;
  /** Optional tag ("turn 7", user-provided). */
  description?: string;
}

export interface CaptureOpts {
  description?: string;
  /** Force-include files covered by .gitignore. Default false —
   *  build artefacts / .env shouldn't pollute the snapshot. */
  includeIgnored?: boolean;
  /** Include untracked files larger than the default 10 MiB cap.
   *  Default false — a stray video / tarball shouldn't inflate
   *  .git/objects. */
  includeLargeUntracked?: boolean;
}

export interface RestoreResult {
  ok: boolean;
  /** Count of new untracked files deleted during restore. */
  untrackedRemoved: number;
  /** Short description of what happened, for chat log. */
  summary: string;
  /** When `ok` is false, a non-empty message. */
  error?: string;
}
