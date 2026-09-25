// ── Ephemeral shell approval cache (X2 prep) ──
//
// Session-scoped Map<commandKey, Decision>. Used by runShell when
// `approval: 'first-time'` is requested: if the key is already in
// the cache with a `session` scope, skip the prompt. `-once` scopes
// never cache.
//
// Keyed by `${cwd}|${argv.join(' ')}` — same command from the same
// cwd collapses to one prompt. Different cwd = different key
// (intentional; `rm -rf` in /tmp is not the same as in $HOME).
//
// Audit log (X2) lives in a sibling module so the cache can be reset
// in tests without wiping audit state.

import { getSessionCwd } from '../session/working-dir.js';
import type { ApprovalDecision, ShellRequest } from './types.js';

/** Build the cache key deterministically so the runtime and the
 *  prompt UI agree on identity. Exported for the audit log + tests.
 *
 *  WD5 — cwd defaults to the session working directory. A Ctrl+W to
 *  a new project naturally invalidates cached approvals from the
 *  previous project (keys change) — matches the user's mental model
 *  ("I'm in a different project now — re-prompt me"). */
export function commandKey(req: Pick<ShellRequest, 'command' | 'cwd'>): string {
  const cwd = req.cwd ?? getSessionCwd();
  const argv = req.command.join(' ');
  return `${cwd}|${argv}`;
}

const cache = new Map<string, ApprovalDecision>();

/** Look up a cached decision. Returns undefined if nothing cached. */
export function getCachedDecision(key: string): ApprovalDecision | undefined {
  return cache.get(key);
}

/** Persist a decision. Only `-session` decisions survive — `-once`
 *  decisions are passed in but discarded here (the caller already
 *  acted on them this turn). The runtime calls this unconditionally;
 *  the filter keeps the cache tight. */
export function rememberDecision(key: string, decision: ApprovalDecision): void {
  if (decision === 'allow-session' || decision === 'deny-session') {
    cache.set(key, decision);
  }
}

/** Test-only reset. Not exposed on the public surface. */
export function _resetApprovalCacheForTesting(): void {
  cache.clear();
}

/** Test-only inspector. */
export function _snapshotApprovalCacheForTesting(): Record<string, ApprovalDecision> {
  return Object.fromEntries(cache.entries());
}
