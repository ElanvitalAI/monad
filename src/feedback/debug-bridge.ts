// M6 PR 1 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — debug.log
// → `debug.line` envelope bridge.
//
// Mirrors low-frequency daemon `debug.log(category, event, data?)` events
// onto the carrier-agnostic Feedback Envelope wire so PWA chat `/chat?debug-
// tap=on` can render a live tail (off-canvas drawer in M6 PR 2). The bridge
// transposes the M5 PR 2 grep emit pattern onto the debug tracer:
//
//   debug.log(...) ──► DebugBridgeSink ──► category filter
//                  └─► ring buffer (cap 200)
//                  └─► activate gate
//                     └─► makeEnvelope(kind: 'debug.line') ──► opts.emit
//
// Activate gate semantics (mirror gate default OFF — matches `/debug
// mirror` legacy):
//   activate()   : subsequent matching events ALSO emit envelopes.
//   deactivate() : events still hit the ring (for in-memory audit)
//                  but stop emitting.
//   dispose()    : unregister sink + drop ring. Idempotent.
//
// Hot-path gates: only low-frequency call sites (LLM requests, plugin
// lifecycle, errors) call `debug.log` unconditionally — those reach this
// sink. The 122 `if (debug.enabled) debug.log(...)` hot-path sites only
// flow when `debug.enabled` is true (mirror|verbose|diag|keytrace). Users
// who want the full firehose flip `/debug diag on` alongside `?debug-
// tap=on`. M6 doc §8 records this trade-off.
//
// Session scoping: the bridge does NOT filter by `rec.session_id` —
// daemon ambient session id is set by REPL/dashboard but not by the
// daemon REST API path. Per-turn lifecycle (the bridge is created in
// handlePromptStreamPost and disposed on turn-end) already gives the
// PWA a turn-window view; events from concurrent turns are not
// disambiguated. Documented as a known v1 limitation — a future
// AsyncLocalStorage-based session scope can land without breaking
// envelopeVersion: 1.

import { debug } from '../debug/log.js';
import type { LogRecord } from '../mss/logging/record.js';
import type { LogSink } from '../mss/logging/sink.js';
import {
  createSeqTracker,
  makeEnvelope,
  type FeedbackEnvelope,
} from './envelope.js';

/** Whitelist of debug categories mirrored onto the wire when the gate
 *  is open. Tunable per bridge instance; the default matches the
 *  user-relevant subsystems (chat turns, tool dispatch, agent state)
 *  while excluding hot-path noise (input.*, window.*, key.trace.*,
 *  mss.*) AND the bridge's own re-entrant categories.
 *
 *  **Critical exclusion** — `acp.*` is deliberately omitted because
 *  emitting an envelope triggers `acp.broadcast.fanout` debug.log
 *  events, which the bridge would re-capture → emit another envelope
 *  → another `acp.broadcast.fanout` → infinite feedback loop. A single
 *  user-driven debug emission was observed to balloon to ~46k
 *  fanouts/sec on iOS dogfood (2026-05-14), saturating the ACP WS
 *  socket and aborting the LLM turn 30s in.
 *
 *  If `acp.session.*` (less noisy ACP sub-category) becomes useful,
 *  add it as an opt-in via the per-bridge `categoryFilter` override
 *  rather than re-enabling the whole `acp.` prefix. */
export const DEFAULT_DEBUG_CATEGORY_FILTER = /^(chat|tool|agent)\./;

export const DEFAULT_DEBUG_RING_CAP = 200;

export interface DebugLineEntry {
  category: string;
  event: string;
  data?: unknown;
  /** ms epoch parsed from `debug.log`'s ISO timestamp. */
  loggedAt: number;
}

export interface DebugBridgeOpts {
  /** Wire writer — typically `dualEmitFeedback` from meta-api's
   *  handlePromptStreamPost. Called synchronously; errors swallow so
   *  a misbehaving consumer can't break debug logging. */
  emit: (env: FeedbackEnvelope) => void;
  sessionId: string;
  /** Override the default whitelist. Set to `/^.*$/` to mirror every
   *  category (combine with `/debug diag on` for full firehose). */
  categoryFilter?: RegExp;
  /** Override the default 200-entry in-memory ring. Floored at 1. */
  ringBufferCap?: number;
  /** Injected for tests. Defaults to Date.now. */
  now?: () => number;
}

export interface DebugBridge {
  /** Open the mirror gate. Idempotent. */
  activate(): void;
  /** Close the mirror gate. Idempotent. Events keep landing in the
   *  ring buffer; only envelope emit stops. */
  deactivate(): void;
  /** True iff the gate is currently open. */
  isActive(): boolean;
  /** Snapshot copy of the in-memory ring (oldest first). */
  getRing(): readonly DebugLineEntry[];
  /** Unregister sink + clear ring. After dispose, all methods are no-ops. */
  dispose(): void;
}

/** Stable session-level merge key — every `debug.line` envelope in a
 *  given session carries this blockId so the PWA accumulator collapses
 *  the entire daemon trace into a single `debug_session` block (drawer
 *  feeds off that one block's `lines` ring). */
export function makeDebugSessionBlockId(sessionId: string): string {
  return `${sessionId}:debug:session`;
}

export function createDebugBridge(opts: DebugBridgeOpts): DebugBridge {
  const filter = opts.categoryFilter ?? DEFAULT_DEBUG_CATEGORY_FILTER;
  const ringCap = Math.max(1, opts.ringBufferCap ?? DEFAULT_DEBUG_RING_CAP);
  const now = opts.now ?? ((): number => Date.now());
  const seqTracker = createSeqTracker();
  const blockId = makeDebugSessionBlockId(opts.sessionId);

  let activated = false;
  let disposed = false;
  const ring: DebugLineEntry[] = [];

  const sink: LogSink = {
    name: `feedback-debug-bridge:${opts.sessionId}`,
    emit(rec: LogRecord): void {
      if (disposed) return;
      if (typeof rec.category !== 'string') return;
      if (!filter.test(rec.category)) return;
      const entry: DebugLineEntry = {
        category: rec.category,
        event: rec.event,
        ...(rec.data !== undefined ? { data: rec.data } : {}),
        loggedAt: parseLogTs(rec.ts),
      };
      ring.push(entry);
      if (ring.length > ringCap) ring.splice(0, ring.length - ringCap);
      if (!activated) return;
      emitEntry(entry);
    },
  };

  const emitEntry = (entry: DebugLineEntry): void => {
    let env: FeedbackEnvelope;
    try {
      env = makeEnvelope(
        {
          kind: 'debug.line',
          sessionId: opts.sessionId,
          blockId,
          phase: 'delta',
          payload: {
            category: entry.category,
            event: entry.event,
            ...(entry.data !== undefined ? { data: entry.data } : {}),
            loggedAt: entry.loggedAt,
          },
          asciiFallback: [renderAscii(entry)],
          now,
        },
        seqTracker,
      );
    } catch {
      return;
    }
    try {
      opts.emit(env);
    } catch {
      /* wire glue swallows — bridge must not break the LLM stream. */
    }
  };

  const unregister = debug.registerSink(sink);

  return {
    activate() {
      if (disposed) return;
      activated = true;
    },
    deactivate() {
      activated = false;
    },
    isActive() {
      return activated && !disposed;
    },
    getRing() {
      return ring.slice();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activated = false;
      ring.length = 0;
      try {
        unregister();
      } catch {
        /* swallow — already removed */
      }
      seqTracker.clear();
    },
  };
}

function parseLogTs(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : Date.now();
}

/** Pre-rendered ASCII fallback for dumb renderers (TUI · iOS text · CLI
 *  dump). Format mirrors `src/debug/log.ts:formatLine` minus the colour
 *  codes — `[HH:MM:SS.mmm] [category] event  payload`. */
function renderAscii(entry: DebugLineEntry): string {
  const time = new Date(entry.loggedAt).toISOString().slice(11, 23);
  const head = `[${time}] [${entry.category}] ${entry.event}`;
  if (entry.data === undefined) return head;
  let payload: string;
  try {
    payload = JSON.stringify(entry.data);
  } catch {
    payload = String(entry.data);
  }
  if (payload.length > 200) payload = payload.slice(0, 197) + '…';
  return `${head}  ${payload}`;
}
