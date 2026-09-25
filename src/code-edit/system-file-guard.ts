// PLAN §4.2 · Phase 1.2 — Self-edit guard helpers.
//
// monad-agent's own source tree is a system area: any Edit / Write
// landing inside it should require explicit user approval no matter
// what `ApprovalPolicy.mode` is set to. Without this gate, a plain
// `policy.mode = 'unsupervised'` (or a `trusted-dirs` policy that
// happens to whitelist `~/source`) lets the LLM mutate its own
// runtime — exactly the "robot building robot" footgun §4.2 names.
//
// Detection walks up from a candidate directory looking for a
// `package.json` with `"name": "monadagent"`. The walk is cached so
// the cost is paid at most once per session per starting cwd.

import * as fs from 'node:fs';
import * as path from 'node:path';

const PACKAGE_NAME = 'monadagent';

const cache = new Map<string, string | null>();

/** Walk upward from `start` until a `package.json` with
 *  `name === "monadagent"` is found. Returns the directory holding
 *  that file, or null when no such ancestor exists. */
export function findMonadRepoRoot(start: string = process.cwd()): string | null {
  const cached = cache.get(start);
  if (cached !== undefined) return cached;
  let dir = path.resolve(start);
  // Bound the walk so we never traverse the entire filesystem; 32
  // levels is far beyond any realistic project nesting.
  for (let i = 0; i < 32; i++) {
    const pkgPath = path.join(dir, 'package.json');
    let raw: string;
    try {
      raw = fs.readFileSync(pkgPath, 'utf8');
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as { name?: unknown };
      if (parsed && parsed.name === PACKAGE_NAME) {
        cache.set(start, dir);
        return dir;
      }
    } catch {
      // Malformed package.json on the way up — keep walking.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cache.set(start, null);
  return null;
}

/** Default `systemFileDirs` value — `[repoRoot]` when the walk
 *  resolves, otherwise an empty list (the guard is then a no-op). */
export function getDefaultSystemFileDirs(start?: string): string[] {
  const root = findMonadRepoRoot(start);
  return root ? [root] : [];
}

/** Module-level kill switch. Honours both `MONAD_SYSTEM_FILE_GUARD=off`
 *  and an in-process flag flipped by tests / the future
 *  `harness.systemFileDirs.disable` config. */
let runtimeDisabled = false;

export function setSystemFileGuardDisabled(disabled: boolean): void {
  runtimeDisabled = disabled;
}

export function isSystemFileGuardDisabled(): boolean {
  if (runtimeDisabled) return true;
  const v = (process.env.MONAD_SYSTEM_FILE_GUARD ?? '').toLowerCase();
  return v === 'off' || v === '0' || v === 'false';
}

/** Test seam — clear the cached lookup so per-test tmpdirs resolve
 *  fresh, and reset the disable flag. */
export function __resetSystemFileGuard(): void {
  cache.clear();
  runtimeDisabled = false;
}
