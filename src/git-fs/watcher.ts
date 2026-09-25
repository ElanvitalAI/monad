// ── git-fs watcher ──
//
// fs.watchFile() on the small set of files whose change indicates
// the branch or the current commit moved:
//
//   <gitDir>/HEAD                    branch switch / detach
//   <commonGitDir>/packed-refs       git gc packs loose refs
//   <commonGitDir>/refs/heads/<br>   a new commit lands on the
//                                    current branch
//
// We rewire the per-branch watcher whenever HEAD flips, because
// the watched ref file path changes with the active branch.
//
// Intentionally NOT watching untracked files — that would require
// watching the whole working tree. The dirty probe is throttled
// separately.

import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { GitHeadInfo } from './types.js';
import type { LocatedGit } from './locate.js';

type Listener = () => void;

export class GitFileWatcher {
  private readonly listeners = new Set<Listener>();
  private headWatcher: FSWatcher | null = null;
  private refWatcher: FSWatcher | null = null;
  private packedRefsWatcher: FSWatcher | null = null;
  private currentBranch: string | null = null;
  private disposed = false;

  constructor(
    private readonly located: LocatedGit,
    private readonly initialHead: GitHeadInfo | null,
  ) {
    this.currentBranch = initialHead?.branch ?? null;
    this.installHeadWatcher();
    this.installRefWatcher();
    this.installPackedRefsWatcher();
  }

  /** Call `fn` whenever HEAD or the current branch's ref file
   *  changes. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Update the watched branch when the caller re-reads HEAD and
   *  finds the branch moved (e.g., after a `git switch`). The
   *  watcher re-binds the ref-file watch to the new branch. */
  retargetForHead(head: GitHeadInfo | null): void {
    const next = head?.branch ?? null;
    if (next === this.currentBranch) return;
    this.currentBranch = next;
    if (this.refWatcher) { this.refWatcher.close(); this.refWatcher = null; }
    this.installRefWatcher();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    if (this.headWatcher) { try { this.headWatcher.close(); } catch {} }
    if (this.refWatcher) { try { this.refWatcher.close(); } catch {} }
    if (this.packedRefsWatcher) { try { this.packedRefsWatcher.close(); } catch {} }
    this.headWatcher = null;
    this.refWatcher = null;
    this.packedRefsWatcher = null;
  }

  private fire(): void {
    if (this.disposed) return;
    for (const fn of this.listeners) {
      try { fn(); } catch { /* never let a listener crash the watcher */ }
    }
  }

  private installHeadWatcher(): void {
    const path = join(this.located.gitDir, 'HEAD');
    try {
      this.headWatcher = watch(path, { persistent: false }, () => this.fire());
    } catch {
      // HEAD may not exist during `git init` transient state; swallow.
    }
  }

  private installRefWatcher(): void {
    if (!this.currentBranch) return;
    const path = join(this.located.commonGitDir, 'refs', 'heads', ...this.currentBranch.split('/'));
    try {
      this.refWatcher = watch(path, { persistent: false }, () => this.fire());
    } catch {
      // Loose ref may be packed — rely on packed-refs watcher.
    }
  }

  private installPackedRefsWatcher(): void {
    const path = join(this.located.commonGitDir, 'packed-refs');
    try {
      this.packedRefsWatcher = watch(path, { persistent: false }, () => this.fire());
    } catch {
      // No packed-refs yet — not an error.
    }
  }
}
