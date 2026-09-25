// Stale-record pruning for `~/.config/monad/acp-sessions.json`.
//
// Companion to L2 (capability-aware persistence) — even after we
// stop *writing* records for ephemeral backends, existing files
// still carry a long tail of stale entries from prior sessions.
// This module is the pure logic; `scripts/clean-acp-sessions.ts`
// is the CLI that exercises it. Living in `src/acp/` (not `scripts/`)
// so unit tests can import it without bundling concerns.
//
// Drop criteria (all default, conservative):
//   1. backendId no longer exists in the current backend registry
//      — e.g. `codex-native` (removed sprint 5B 2026-04-28),
//        `codex` (legacy alias, replaced by `codex-app-server`)
//   2. backendId is on the known-ephemeral list — backends that
//      advertise `loadSession: false` at runtime can never resume
//      a persisted id, so the disk record is dead weight that
//      forces an unnecessary load → fail → drop cycle on every
//      startup. L2 (turn-runner.ts) keeps these in an in-process
//      cache going forward.
//
// Optional flags (caller passes via opts):
//   - `missingCwd: true` — drop dashboard records whose cwd no
//     longer exists on disk. Off by default because removable
//     volumes (USB drives, network mounts) trigger false positives.
//   - `olderThanDays: N` — drop records older than N days by
//     `updatedAt`. Off by default — multi-week conversations are
//     legitimate.
//
// Output is structured (`PruneResult`) so the CLI can render a
// before/after diff and tests can assert each criterion in isolation.

import { existsSync } from 'node:fs';
import type { AcpSessionRecord } from './session-store.js';
import { ACP_BACKENDS } from './backend-registry.js';

/** Backends whose runtime-advertised `loadSession` capability is
 *  known to be `false`. Persisted ids for these have no value
 *  across a process restart.
 *
 *  Source of truth: `defaultAgentCapabilities()` would be the
 *  proper API, but it returns the conservative pre-init view (most
 *  default false). Real runtime state comes from the live peer's
 *  initialize response — which we obviously don't have offline.
 *
 *  This list captures what we actually observed at the time of the
 *  L2 incident (2026-05-02 · gemini-cli 0.38.0). Add ids here as
 *  more backends graduate to ephemeral.
 *
 *  `claude` and `codex-app-server` advertise `loadSession: true`
 *  in practice and stay in the persistent store. */
const KNOWN_EPHEMERAL_BACKENDS = new Set<string>(['gemini']);

export interface PruneOpts {
  /** Drop records whose chatId encodes a dashboard cwd that no
   *  longer exists. Format: `dashboard:<absolute-path>`. */
  missingCwd?: boolean;
  /** Drop records older than this many days by `updatedAt`. */
  olderThanDays?: number;
  /** "Now" injection for tests — defaults to `new Date()`. */
  now?: Date;
  /** Override the orphan-backend set for tests. Defaults to the
   *  current `ACP_BACKENDS` registry plus aliases listed below. */
  knownBackends?: ReadonlySet<string>;
  /** Override the ephemeral set for tests. */
  ephemeralBackends?: ReadonlySet<string>;
}

export type DropReason =
  | 'unknown-backend'
  | 'ephemeral-backend'
  | 'missing-cwd'
  | 'older-than-threshold';

export interface PruneDecision {
  record: AcpSessionRecord;
  drop: boolean;
  reason?: DropReason;
}

export interface PruneResult {
  kept: AcpSessionRecord[];
  dropped: Array<{ record: AcpSessionRecord; reason: DropReason }>;
  /** Per-reason counts for compact CLI rendering. */
  countsByReason: Record<DropReason, number>;
}

/** Default known-backend set: the live registry. Exported so tests
 *  + the CLI can show "what counts as known" without re-deriving. */
export function defaultKnownBackends(): Set<string> {
  return new Set(Object.keys(ACP_BACKENDS));
}

/** Decide for a single record. Pure — no I/O except the optional
 *  cwd-existence check, which the caller can disable via opts. */
export function classifyRecord(
  record: AcpSessionRecord,
  opts: PruneOpts = {},
): PruneDecision {
  const known = opts.knownBackends ?? defaultKnownBackends();
  const ephemeral = opts.ephemeralBackends ?? KNOWN_EPHEMERAL_BACKENDS;

  if (!known.has(record.backendId)) {
    return { record, drop: true, reason: 'unknown-backend' };
  }
  if (ephemeral.has(record.backendId)) {
    return { record, drop: true, reason: 'ephemeral-backend' };
  }
  if (opts.missingCwd) {
    // Dashboard chat keys are encoded as `dashboard:<absolute-path>`.
    // Messenger keys are pure ids (Telegram chat number / Discord
    // snowflake) and aren't path-shaped, so this rule only applies
    // to dashboard records.
    const cwdPrefix = 'dashboard:';
    if (record.chatId.startsWith(cwdPrefix)) {
      const cwd = record.chatId.slice(cwdPrefix.length);
      if (cwd.length > 0 && !existsSync(cwd)) {
        return { record, drop: true, reason: 'missing-cwd' };
      }
    }
  }
  if (typeof opts.olderThanDays === 'number' && opts.olderThanDays > 0) {
    const now = opts.now ?? new Date();
    const ts = Date.parse(record.updatedAt);
    if (Number.isFinite(ts)) {
      const ageDays = (now.getTime() - ts) / (24 * 60 * 60 * 1000);
      if (ageDays > opts.olderThanDays) {
        return { record, drop: true, reason: 'older-than-threshold' };
      }
    }
  }
  return { record, drop: false };
}

/** Apply pruning across a list of records. Stable order — kept
 *  records preserve their original sequence, dropped records are
 *  collected in encountered order. */
export function pruneStaleRecords(
  records: readonly AcpSessionRecord[],
  opts: PruneOpts = {},
): PruneResult {
  const kept: AcpSessionRecord[] = [];
  const dropped: Array<{ record: AcpSessionRecord; reason: DropReason }> = [];
  const countsByReason: Record<DropReason, number> = {
    'unknown-backend': 0,
    'ephemeral-backend': 0,
    'missing-cwd': 0,
    'older-than-threshold': 0,
  };
  for (const r of records) {
    const decision = classifyRecord(r, opts);
    if (decision.drop && decision.reason) {
      dropped.push({ record: decision.record, reason: decision.reason });
      countsByReason[decision.reason] += 1;
    } else {
      kept.push(r);
    }
  }
  return { kept, dropped, countsByReason };
}
