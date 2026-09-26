import { lstatSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

import { resolveMainRepoRoot } from '../git-fs/worktree.js';
import type { DefaultSeamsOptions } from './seams.js';
import type { TargetKind } from './target-kind.js';

type HarnessTargetStatus = TargetKind | 'normalization-failed';

export interface HarnessTargetResolution {
  status: HarnessTargetStatus;
  /** The filesystem kind independently of the home-authorization status. */
  kind?: Exclude<TargetKind, 'outside-home' | 'missing'>;
  target: string;
  canonicalHome?: string;
  canonicalTarget?: string;
  repoRoot?: string;
  reason?: string;
}

interface ResolveHarnessTargetOptionsDeps {
  home?: string;
  resolveMainRepoRoot?: (cwd: string) => string | null;
  realpath?: (path: string) => string;
  lstat?: typeof lstatSync;
  stat?: typeof statSync;
}

function isStrictDescendant(path: string, parent: string): boolean {
  return path.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function normalizationFailure(target: string, reason: string): HarnessTargetResolution {
  return { status: 'normalization-failed', target, reason };
}

/**
 * Resolves a requested harness target once into canonical values that downstream
 * seams may consume. HITL is intentionally not called here: callers decide how
 * to authorize the returned `outside-home` state.
 */
export function resolveHarnessTarget(target: string, deps: ResolveHarnessTargetOptionsDeps = {}): HarnessTargetResolution {
  const realpath = deps.realpath ?? realpathSync;
  const lstat = deps.lstat ?? lstatSync;
  const stat = deps.stat ?? statSync;
  const requested = resolve(target);
  let canonicalHome: string;
  try {
    canonicalHome = realpath(resolve(deps.home ?? homedir()));
  } catch (error) {
    return normalizationFailure(target, `home normalization failed: ${String(error)}`);
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = realpath(requested);
  } catch (error) {
    try {
      if (lstat(requested).isSymbolicLink()) {
        return normalizationFailure(target, `target normalization failed: ${String(error)}`);
      }
    } catch {
      return { status: 'missing', target, canonicalHome };
    }
    return normalizationFailure(target, `target normalization failed: ${String(error)}`);
  }

  const targetOutsideHome = !isStrictDescendant(canonicalTarget, canonicalHome);
  const repoLocator = deps.resolveMainRepoRoot ?? resolveMainRepoRoot;
  const resolvedRepoRoot = repoLocator(canonicalTarget);
  if (resolvedRepoRoot) {
    let repoRoot: string;
    try {
      repoRoot = realpath(resolve(resolvedRepoRoot));
    } catch (error) {
      return normalizationFailure(target, `repository root normalization failed: ${String(error)}`);
    }
    const repoOutsideHome = !isStrictDescendant(repoRoot, canonicalHome);
    if (targetOutsideHome || repoOutsideHome) {
      return {
        status: 'outside-home', kind: 'git-repo', target, canonicalHome, canonicalTarget, repoRoot,
        ...(repoOutsideHome ? { reason: 'repository root resolves outside home' } : {}),
      };
    }
    return { status: 'git-repo', kind: 'git-repo', target, canonicalHome, canonicalTarget, repoRoot };
  }

  let kind: 'non-git-dir' | 'file';
  try {
    kind = stat(canonicalTarget).isDirectory() ? 'non-git-dir' : 'file';
  } catch (error) {
    return normalizationFailure(target, `target stat failed: ${String(error)}`);
  }
  return targetOutsideHome
    ? { status: 'outside-home', kind, target, canonicalHome, canonicalTarget }
    : { status: kind, kind, target, canonicalHome, canonicalTarget };
}

/** Converts a resolved, authorized target to the existing seam-option contract. */
export function harnessTargetOptions(
  resolution: HarnessTargetResolution,
  elanousBinRoot: string,
): DefaultSeamsOptions | undefined {
  if ((resolution.status === 'git-repo' || resolution.kind === 'git-repo') && resolution.repoRoot) {
    return { repoRoot: resolution.repoRoot, elanousBinRoot };
  }
  const targetKind = resolution.status === 'non-git-dir' || resolution.status === 'file'
    ? resolution.status
    : resolution.kind === 'non-git-dir' || resolution.kind === 'file'
      ? resolution.kind
      : undefined;
  if (targetKind && resolution.canonicalTarget) {
    return { targetKind, targetPath: resolution.canonicalTarget, elanousBinRoot };
  }
  return undefined;
}

/** Re-resolves a target so callers can reject a symlink retarget between stages. */
export function revalidateHarnessTarget(
  prior: HarnessTargetResolution,
  deps: ResolveHarnessTargetOptionsDeps = {},
): HarnessTargetResolution {
  const current = resolveHarnessTarget(prior.target, deps);
  if (
    current.status !== prior.status
    || current.canonicalTarget !== prior.canonicalTarget
    || current.repoRoot !== prior.repoRoot
    || current.canonicalHome !== prior.canonicalHome
  ) {
    return normalizationFailure(prior.target, 'target changed during revalidation');
  }
  return current;
}
