// ACP H3 #6 — Background session lifecycle manager.
//
// Wraps a DualRoleManager client session with a non-blocking
// lifecycle state machine so LLM callers can kick off a long turn
// via `AcpSessionStartBackground`, poll status via
// `AcpSessionStatus`, cancel via `AcpSessionCancel`, and retrieve
// final output via `AcpSessionJoin` — all without holding elanous's
// main loop hostage.
//
// State machine:
//   running ──signalWaiting──> waiting_for_confirmation
//     │ ◄─signalResumed──┤
//     │                    │
//     ▼                    ▼
//   completed / failed / cancelled  (terminal · no further transitions)
//
// Output capture: callers wire `registerChunk` into their onUpdate
// stream so BG sees text deltas as they arrive. `outputPreview` is
// bounded (previewCap, default 2KB) for status polling; `fullOutput`
// is unbounded and delivered via Join.
//
// Subscribe: `onStateChange(listener)` returns an unsubscribe fn.
// Called synchronously on every transition with (record, prev).
// Exceptions are swallowed so one bad listener doesn't wedge others.
//
// Reference · Warp (primary per user 2026-04-22): Oz cloud-agent
//   semantics — start async, push on approval/completion, tap to
//   join. Local-disk + iPhone-push equivalent here.
// Reference · Zed: no direct analog (all threads foreground). Borrow
//   state-transition idiom from `AcpThread::push_entry` +
//   request_permission flow.

import { basename } from 'node:path';
import type { StopReason } from '@agentclientprotocol/sdk';
import { debug } from '../debug/log.js';
import type { AcpSessionStub, SessionStatus } from '../session/card.js';
import type {
  AcpPermissionApprover,
  AcpQuestionApprover,
} from './client.js';

export type BackgroundState =
  | 'running'
  | 'waiting_for_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const TERMINAL_BACKGROUND_STATES: readonly BackgroundState[] = [
  'completed',
  'failed',
  'cancelled',
];

export interface BackgroundSessionRecord {
  /** Namespaced id — `acp-bg:<client-session-id>`. */
  id: string;
  /** Underlying DualRoleManager client session id. */
  clientSessionId: string;
  backendSessionId: string;
  backendId: string;
  cwd: string;
  initialMessage: string;
  state: BackgroundState;
  startedAt: number;
  lastSeenAt: number;
  endedAt?: number;
  /** Bounded preview (capped at previewCap). For Status tool. */
  outputPreview: string;
  /** Full collected output. Returned by Join. */
  fullOutput: string;
  stopReason?: StopReason;
  error?: string;
  /** Free-form tag for persistence / sidebar rendering. */
  origin?: string;
}

export interface BackgroundManagerOpts {
  now?: () => number;
  /** Max chars kept in outputPreview. Default 2048. */
  previewCap?: number;
}

export interface BackgroundStartOpts {
  clientSessionId: string;
  backendSessionId: string;
  backendId: string;
  cwd: string;
  initialMessage: string;
  /** Promise returned by `DualRoleManager.clientSessionSend` that
   *  resolves with the turn's stopReason. Manager flips to the
   *  appropriate terminal state when it settles. */
  turnPromise: Promise<{ stopReason: StopReason }>;
  /** Caller wires this feed into their onUpdate so BG sees chunks
   *  as they arrive. Manager returns a feed function to call. */
  registerChunk: (feed: (text: string) => void) => void;
  /** Caller wires these into their onUpdate arm that observes
   *  tool_call_update transitions. `signalWaiting` moves BG into
   *  waiting_for_confirmation; `signalResumed` moves it back to
   *  running (both are no-ops in terminal states). */
  registerApprovalSignal: (
    signalWaiting: () => void,
    signalResumed: () => void,
  ) => void;
  origin?: string;
}

export interface BackgroundManager {
  /** Create a record in `running` state and arm the lifecycle. The
   *  record is returned synchronously; the turn runs async. */
  start(opts: BackgroundStartOpts): BackgroundSessionRecord;
  /** Current snapshot or null. */
  status(id: string): BackgroundSessionRecord | null;
  /** Cancel an in-flight turn. `doCancel` is the caller-supplied
   *  function that actually cancels the underlying session (e.g.
   *  `() => dualRoleManager.clientSessionClose(clientSessionId)`).
   *  Manager flips state to `cancelled` (if not already terminal)
   *  and invokes doCancel. Idempotent: calling on terminal record
   *  returns false. */
  cancel(id: string, doCancel: () => Promise<void>): Promise<boolean>;
  /** Enumerate every background record (terminal included). Use
   *  `sweep()` for periodic GC. */
  list(): BackgroundSessionRecord[];
  /** Alias for status — intended to be called by `AcpSessionJoin`
   *  post-completion to retrieve fullOutput. Identical shape. */
  join(id: string): BackgroundSessionRecord | null;
  /** Subscribe to state transitions. Returns an unsubscribe fn. */
  onStateChange(
    listener: (record: BackgroundSessionRecord, prev: BackgroundState) => void,
  ): () => void;
  /** UI-Core arc Phase U1 — subscribe to start() events. The existing
   *  `onStateChange` listener only fires on transitions, but start()
   *  mints records already in `running` so a separate channel is
   *  needed for the SessionStore facade to observe the creation. */
  onCreate(listener: (record: BackgroundSessionRecord) => void): () => void;
  /** Follow-up #6 — TTL sweep. Removes terminal records whose
   *  `endedAt` is older than `now - olderThanMs`. Active records
   *  (running / waiting_for_confirmation) and terminal records
   *  missing `endedAt` are preserved. Returns the ids removed, in
   *  no guaranteed order. Idempotent: sweeping twice with no new
   *  writes returns `[]` the second time. Auto-persist (follow-up
   *  #1) already wrote the record to disk before the terminal
   *  transition, so on-disk history is unaffected — this sweep is
   *  an in-memory GC only. */
  sweep(olderThanMs: number): string[];
  /** Follow-up #6 — arm a periodic sweep. Calls `sweep(olderThanMs)`
   *  every `intervalMs`. Returns a dispose fn that clears the
   *  timer. Safe to call more than once (each call returns its own
   *  disposer · stacking intervals is up to the caller). Timer
   *  errors are swallowed · one bad run doesn't stop the schedule. */
  startAutoSweep(opts: { intervalMs: number; olderThanMs: number }): () => void;
  /** Follow-up #9 — HITL direct wire. External consumers (e.g. the
   *  `hitl-acp-adapter`) call these when they detect an approval
   *  request / resolution without relying on the peer's
   *  `tool_call_update.status` field. Takes raw `(backendId,
   *  backendSessionId)` — the same identity pair `AcpAgent`'s
   *  approver callbacks already carry (`req.backendId` +
   *  `req.sessionId`), so the adapter doesn't need to know about
   *  elanous's `acp-cli:<brand>:<raw>` namespacing scheme.
   *
   *  No-op when no BG record matches, when the record is terminal,
   *  or when the record is already in the target state — idempotency
   *  mirrors the existing wire path so both fire-paths can coexist
   *  safely. Backends that don't emit the wire `status` field
   *  (codex-acp / gemini-cli at least partially) finally get correct
   *  `waiting_for_confirmation` UX through this arm alone. */
  signalApprovalWaiting(backendId: string, backendSessionId: string): void;
  signalApprovalResumed(backendId: string, backendSessionId: string): void;
}

const DEFAULT_PREVIEW_CAP = 2048;

function bgIdFromClientId(clientSessionId: string): string {
  return `acp-bg:${clientSessionId}`;
}

export function createBackgroundManager(
  opts: BackgroundManagerOpts = {},
): BackgroundManager {
  const now = opts.now ?? (() => Date.now());
  const previewCap = opts.previewCap ?? DEFAULT_PREVIEW_CAP;
  const records = new Map<string, BackgroundSessionRecord>();
  const listeners = new Set<
    (record: BackgroundSessionRecord, prev: BackgroundState) => void
  >();
  const createListeners = new Set<(record: BackgroundSessionRecord) => void>();
  const fireCreate = (record: BackgroundSessionRecord): void => {
    for (const fn of Array.from(createListeners)) {
      try { fn(record); } catch { /* listener errors must not wedge others */ }
    }
  };

  const isTerminal = (state: BackgroundState): boolean =>
    TERMINAL_BACKGROUND_STATES.includes(state);

  const notify = (
    record: BackgroundSessionRecord,
    prev: BackgroundState,
  ): void => {
    if (prev === record.state) return;
    for (const fn of Array.from(listeners)) {
      try {
        fn(record, prev);
      } catch (err) {
        if (debug.enabled) {
          debug.log('acp.bg.listener-error', record.id, {
            message: (err as Error)?.message,
          }, { level: 'error' });
        }
      }
    }
  };

  const findByBackendIdentity = (
    backendId: string,
    backendSessionId: string,
  ): BackgroundSessionRecord | null => {
    // Usually there are only a handful of live BG records · O(N) is
    // fine and avoids maintaining a secondary index that can drift.
    for (const rec of records.values()) {
      if (rec.backendId === backendId && rec.backendSessionId === backendSessionId) {
        return rec;
      }
    }
    return null;
  };

  const doSweep = (olderThanMs: number): string[] => {
    const cutoff = now() - olderThanMs;
    const removed: string[] = [];
    for (const record of Array.from(records.values())) {
      if (!isTerminal(record.state)) continue;
      // `endedAt` is populated on every terminal transition; absence
      // means the record entered terminal via some non-standard path
      // (legacy snapshot or future direct mutation) · skip rather
      // than guess.
      if (record.endedAt === undefined) continue;
      if (record.endedAt >= cutoff) continue;
      records.delete(record.id);
      removed.push(record.id);
    }
    if (debug.enabled && removed.length > 0) {
      debug.log('acp.bg.sweep', `${removed.length} record(s)`, {
        olderThanMs,
        ids: removed,
      });
    }
    return removed;
  };

  const transition = (
    record: BackgroundSessionRecord,
    next: BackgroundState,
  ): boolean => {
    if (isTerminal(record.state)) return false;
    if (record.state === next) return false;
    const prev = record.state;
    record.state = next;
    record.lastSeenAt = now();
    if (isTerminal(next)) record.endedAt = record.lastSeenAt;
    if (debug.enabled) {
      debug.log('acp.bg.transition', `${record.id}: ${prev}→${next}`, {
        id: record.id,
        from: prev,
        to: next,
      });
    }
    notify(record, prev);
    return true;
  };

  return {
    start(startOpts) {
      const id = bgIdFromClientId(startOpts.clientSessionId);
      const ts = now();
      const record: BackgroundSessionRecord = {
        id,
        clientSessionId: startOpts.clientSessionId,
        backendSessionId: startOpts.backendSessionId,
        backendId: startOpts.backendId,
        cwd: startOpts.cwd,
        initialMessage: startOpts.initialMessage,
        state: 'running',
        startedAt: ts,
        lastSeenAt: ts,
        outputPreview: '',
        fullOutput: '',
      };
      if (startOpts.origin !== undefined) record.origin = startOpts.origin;
      records.set(id, record);
      fireCreate(record);

      if (debug.enabled) {
        debug.log('acp.bg.start', id, {
          backendId: record.backendId,
          cwd: record.cwd,
        });
      }

      // Output feed — append to fullOutput, keep preview bounded.
      startOpts.registerChunk((text) => {
        if (isTerminal(record.state)) return;
        record.fullOutput += text;
        record.outputPreview = record.fullOutput.length <= previewCap
          ? record.fullOutput
          : record.fullOutput.slice(record.fullOutput.length - previewCap);
        record.lastSeenAt = now();
      });

      // Approval signals — tool-call-state observer tells us when
      // the turn is gated on user confirmation.
      startOpts.registerApprovalSignal(
        () => { transition(record, 'waiting_for_confirmation'); },
        () => { transition(record, 'running'); },
      );

      // Turn lifecycle — flip terminal state when the promise
      // settles. Guarded against race with explicit cancel.
      startOpts.turnPromise.then(
        (result) => {
          if (isTerminal(record.state)) return; // cancel beat us here
          const reason = String(result.stopReason);
          record.stopReason = result.stopReason;
          transition(
            record,
            reason === 'cancelled' ? 'cancelled' : 'completed',
          );
        },
        (err: unknown) => {
          if (isTerminal(record.state)) return;
          record.error = err instanceof Error ? err.message : String(err);
          transition(record, 'failed');
        },
      );

      return record;
    },

    status(id) {
      return records.get(id) ?? null;
    },

    async cancel(id, doCancel) {
      const record = records.get(id);
      if (!record) return false;
      if (isTerminal(record.state)) return false;
      const ok = transition(record, 'cancelled');
      try {
        await doCancel();
      } catch (err) {
        if (debug.enabled) {
          debug.log('acp.bg.cancel-error', id, {
            message: (err as Error)?.message,
          }, { level: 'error' });
        }
        // still return ok=true — we flipped state even if cancel RPC
        // failed best-effort.
      }
      return ok;
    },

    list() {
      return Array.from(records.values());
    },

    join(id) {
      return records.get(id) ?? null;
    },

    onStateChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    onCreate(listener) {
      createListeners.add(listener);
      return () => { createListeners.delete(listener); };
    },

    sweep(olderThanMs) {
      return doSweep(olderThanMs);
    },

    signalApprovalWaiting(backendId, backendSessionId) {
      const record = findByBackendIdentity(backendId, backendSessionId);
      if (!record) return;
      if (isTerminal(record.state)) return;
      transition(record, 'waiting_for_confirmation');
    },

    signalApprovalResumed(backendId, backendSessionId) {
      const record = findByBackendIdentity(backendId, backendSessionId);
      if (!record) return;
      if (isTerminal(record.state)) return;
      // Only flip back to running from the waiting state — matches
      // the wire-status arm's semantics and avoids clobbering other
      // in-between states added in the future.
      if (record.state !== 'waiting_for_confirmation') return;
      transition(record, 'running');
    },

    startAutoSweep(autoOpts) {
      const tick = (): void => {
        try {
          doSweep(autoOpts.olderThanMs);
        } catch (err) {
          if (debug.enabled) {
            debug.log('acp.bg.auto-sweep-error', 'tick', {
              message: (err as Error)?.message,
            }, { level: 'error' });
          }
        }
      };
      const handle = setInterval(tick, autoOpts.intervalMs);
      // Node will hold the process open while an unref()'d interval
      // lives · sweep is a best-effort GC, not a critical path, so
      // unref to match the dashboard-boot wiring's long-running
      // daemon semantics (other intervals in the dashboard use the
      // same pattern).
      if (typeof handle.unref === 'function') handle.unref();
      if (debug.enabled) {
        debug.log('acp.bg.auto-sweep.start', `every ${autoOpts.intervalMs}ms`, {
          olderThanMs: autoOpts.olderThanMs,
        });
      }
      return () => {
        clearInterval(handle);
        if (debug.enabled) debug.log('acp.bg.auto-sweep.stop', 'disposed');
      };
    },
  };
}

let _singleton: BackgroundManager | null = null;
export function globalBackgroundManager(): BackgroundManager {
  if (!_singleton) _singleton = createBackgroundManager();
  return _singleton;
}

/** Test reset. */
export function _resetBackgroundManagerForTests(): void {
  _singleton = null;
}

/** Follow-up #9 — wrap an existing permission approver so it signals
 *  BG approval waiting/resumed around every request. Works with the
 *  modal approver (`dashboard-approvers.createAcpPermissionApprover`)
 *  AND the HITL adapter approver — both paths get the correct BG
 *  state transitions without the peer's wire `status` field. No-op
 *  when the request targets a non-BG session (foreground DRM). */
export function withBgApprovalSignals(
  approver: AcpPermissionApprover,
  bg: BackgroundManager,
): AcpPermissionApprover {
  return async (req) => {
    bg.signalApprovalWaiting(req.backendId, req.sessionId);
    try {
      return await approver(req);
    } finally {
      bg.signalApprovalResumed(req.backendId, req.sessionId);
    }
  };
}

/** Follow-up #9 — same as `withBgApprovalSignals` but for the
 *  question approver slot. Keeps the BG waiting across every
 *  question in the set (matches the HITL adapter's semantics). */
export function withBgQuestionSignals(
  approver: AcpQuestionApprover,
  bg: BackgroundManager,
): AcpQuestionApprover {
  return async (req) => {
    bg.signalApprovalWaiting(req.backendId, req.sessionId);
    try {
      return await approver(req);
    } finally {
      bg.signalApprovalResumed(req.backendId, req.sessionId);
    }
  };
}

// ─── Follow-up #3 · sidebar kind helpers ────────────────────────
//
// Pure mappings from BG domain to the sidebar's generic shapes.
// Dashboard's refreshSessionCardsInto pipes the results through
// listSessionCards' listAcpSessions + status hooks. Keeping these
// as pure helpers means test seams don't need a manager instance.

/** Lifecycle state → sidebar 4-state badge. `cancelled` maps to `err`
 *  (red, not green) — user-facing "this didn't complete its task"
 *  semantic · matches Warp cloud-agent cancelled UX. */
export function bgStateToSessionStatus(state: BackgroundState): SessionStatus {
  switch (state) {
    case 'running':                  return 'working';
    case 'waiting_for_confirmation': return 'awaiting';
    case 'completed':                return 'done';
    case 'failed':                   return 'err';
    case 'cancelled':                return 'err';
  }
}

/** Flatten a BG record to the sidebar's generic `AcpSessionStub`.
 *  `agentKind` is always `'background'` (one-kind-one-glyph layout
 *  contract); original brand is preserved in `meta.backendId`. */
export function backgroundToStub(record: BackgroundSessionRecord): AcpSessionStub {
  const cwdBasename = record.cwd ? basename(record.cwd) : '';
  const title = cwdBasename
    ? `BG · ${record.backendId} · ${cwdBasename}`
    : `BG · ${record.backendId}`;
  const alive = !TERMINAL_BACKGROUND_STATES.includes(record.state);
  const meta: Record<string, unknown> = {
    namespace: 'acp-bg',
    backendId: record.backendId,
    backendSessionId: record.backendSessionId,
    clientSessionId: record.clientSessionId,
    state: record.state,
  };
  if (record.stopReason !== undefined) meta['stopReason'] = String(record.stopReason);
  if (record.error !== undefined) meta['error'] = record.error;
  if (record.origin !== undefined) meta['origin'] = record.origin;
  return {
    id: record.id,
    title,
    agentKind: 'background',
    isAlive: alive,
    createdAt: record.startedAt,
    lastActivityAt: record.lastSeenAt,
    meta,
  };
}
