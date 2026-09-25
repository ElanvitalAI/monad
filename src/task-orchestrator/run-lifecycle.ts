// ── TOX run lifecycle scaffold (MSS M1.2 sub-PR #B · agentic-flow P0-A) ──
//
// A "run" is a single execution attempt of a TOX task — analogous to a turn
// in chat, but on the orchestrator side. Each run gets a fresh `RunUri`
// minted up-front; downstream phases (M3 signal-bus / M4 memory model /
// SAM S1 turn↔run join) hang capture data off this id.
//
// This file is deliberately a scaffold:
//   - The `RunStatus` enum + `RunArtifacts` interface pin the shape so
//     `agentic-flow` PLAN §5 P0-A can plug in capture pipelines without
//     a follow-up rename.
//   - `newRun()` is a constructor — it does not register with any global
//     store yet. M3+M5 phases will wire that in.
//
// No persistence, no event emission, no consumers. The point is the type.

import { mintRunUri } from '../mss/uri/builder.js';
import type { RunUri } from '../mss/uri/brand.js';

/** Lifecycle states a run passes through. The set is closed: a run that
 *  did not reach `completed` / `failed` / `cancelled` is still `started`
 *  or `running`. */
export const RUN_STATUSES = ['started', 'running', 'completed', 'failed', 'cancelled'] as const;
export type RunStatus = typeof RUN_STATUSES[number];

/** Capture surface for downstream phases. A live run accumulates entries
 *  here as it executes; the array fields stay empty until M3+M4 wire the
 *  emit hooks. Shape is frozen now so consumers can pin against it. */
export interface RunArtifacts {
  /** Memory writes attributed to this run (MemoryUri targets). M4 wires
   *  the actual capture; today the field stays empty. */
  memoryWrites: string[];
  /** Signals emitted by this run (SignalUri values). M3 fills these. */
  signalEmits: string[];
  /** Tool-call URIs invoked. Optional — many runs do not invoke tools. */
  toolCalls?: string[];
}

/** Snapshot of a run at a point in time. The lifecycle helpers mutate
 *  copies rather than this record — treat instances as immutable. */
export interface RunRecord {
  runId: RunUri;
  status: RunStatus;
  startedAt: number;
  /** Set when the run leaves an active state. */
  endedAt?: number;
  artifacts: RunArtifacts;
}

/** Create a new RunRecord in the `started` state. The caller is
 *  responsible for transitioning it through `running → completed` (or one
 *  of the failure states). The MSS wire format for `runId` is the canonical
 *  Tier 2 `run/<ULID>` MonadUri — no special-case wire form, unlike turn. */
export function newRun(): RunRecord {
  return {
    runId: mintRunUri(),
    status: 'started',
    startedAt: Date.now(),
    artifacts: {
      memoryWrites: [],
      signalEmits: [],
    },
  };
}

/** Return a copy of `record` with the next status applied. Throws when the
 *  transition is not legal — the lifecycle is a small DAG, so accidents
 *  fail loud rather than silently corrupting downstream telemetry. */
export function transitionRun(record: RunRecord, next: RunStatus): RunRecord {
  if (!isLegalTransition(record.status, next)) {
    throw new Error(`Illegal run transition: ${record.status} → ${next}`);
  }
  const terminal = next === 'completed' || next === 'failed' || next === 'cancelled';
  return {
    ...record,
    status: next,
    ...(terminal ? { endedAt: Date.now() } : {}),
  };
}

function isLegalTransition(from: RunStatus, to: RunStatus): boolean {
  if (from === to) return false;
  if (from === 'started') return to === 'running' || to === 'cancelled' || to === 'failed';
  if (from === 'running') return to === 'completed' || to === 'failed' || to === 'cancelled';
  return false;
}
