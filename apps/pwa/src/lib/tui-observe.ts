// ⭐P2 (capture substrate) — collect live `terminalFrame` snapshots from
// the ACP `agent_thought_chunk` stream so the PWA can live-mirror the
// interactive dashboard TUI (and any other self-reporting surface) that
// runs in a SEPARATE process. Read-only monitoring: each frame REPLACES
// the prior screen for its surface (full-screen snapshot, not a stream).
//
// This module is the pure reducer half — no React, no ACP wiring — so the
// collect logic is unit-testable in isolation. `TuiMirrorView` owns the
// subscription and feeds envelope texts through `applyTuiFrameEnvelope`.
//
// cf. daemon-side `src/capture/tui-frame-broadcaster.ts` (producer) +
// PLAN-self-observation-capture-substrate §2/§5.

import { parseElanousTermEnvelope } from './elanous-term-envelope';

/** Strip ANSI escape sequences so a renderScreen() grid with color SGR
 *  renders as clean text in the mirror. Mirrors the daemon observatory's
 *  `?ansi=strip`. Covers OSC (`ESC] … BEL/ST`), CSI (incl. colon-form SGR
 *  params), and 2-char Fe sequences.
 *  ⚠️ Order matters — regex alternation is first-match: OSC (`ESC]`) and
 *  CSI (`ESC[`) MUST precede the generic 2-char Fe class, because that
 *  class spans `[` (0x5B) and `]` (0x5D) and would otherwise consume only
 *  the introducer, leaving the body behind (review must-fix · gpt-5.6-sol). */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** One surface's latest rendered frame. */
export interface TuiObserveFrame {
  /** Composite Map key (instance + surfaceId · see surfaceKey) — two instances
   *  (prod vs test) can hold the same recycled PID `tui:<pid>`, so keying
   *  by surfaceId alone collides / mis-drops across instances (review
   *  must-fix · gpt-5.6-sol). */
  key: string;
  /** surfaceId — e.g. `tui:<pid>`. Doubles as terminalId on the wire. */
  surfaceId: string;
  /** Rendered screen text (post-ANSI grid · picker/modal 포함). */
  frame: string;
  /** Fleet federation key (operating/test scope). Part of the identity. */
  instance: string;
  /** Epoch ms the frame was rendered (daemon clock · SelfReportFrame.at).
   *  Monotonic per surface → used to drop stale/out-of-order frames. */
  at: number;
  /** LOCAL clock (ms) when this frame was received. Expiry uses this, NOT
   *  `at`, so daemon↔device clock skew can't wrongly expire a live surface.
   *  `terminalFrame` carries no exit signal, so a surface that stops
   *  emitting (TUI closed) is detected purely by receive-staleness. */
  receivedAt: number;
}

/** Composite-key separator: a NUL (U+0000) that can't appear in an
 *  instance name or `tui:<pid>` surfaceId. Written as an ESCAPE so the
 *  source stays plain text — a raw control byte makes git treat the file
 *  as binary and hides the diff (review must-fix · gpt-5.6-sol). */
const SURFACE_KEY_SEP = '\u0000';

/** Composite surface key — instance-scoped so recycled PIDs across
 *  instances never collide. Internal — the composite key travels on each
 *  frame's `key` field, so nothing outside this module recomputes it. */
function surfaceKey(instance: string, surfaceId: string): string {
  return `${instance}${SURFACE_KEY_SEP}${surfaceId}`;
}

/** key → latest frame. Immutable-swap on update so React `useState`
 *  setters see a new reference. */
export type TuiObserveState = ReadonlyMap<string, TuiObserveFrame>;

export const emptyTuiObserveState: TuiObserveState = new Map();

/** Surfaces idle longer than this (no new frame received) are treated as
 *  dead and pruned. Live surfaces refresh every ~1–1.5s (daemon frame
 *  throttle + 1s poll), so 15s is comfortably above the live cadence. */
export const TUI_SURFACE_STALE_MS = 15_000;

/** Fold one ACP `agent_thought_chunk` text into the observe state.
 *  Returns the SAME state reference (no re-render) when the text is not a
 *  `terminalFrame` envelope or the frame is strictly OLDER than the one
 *  held for that surface (out-of-order). A same-`at` re-send refreshes
 *  `receivedAt` (liveness — a static-screen producer that resends the same
 *  frame must not be wrongly pruned · review should-fix). Surfaces are
 *  keyed by `(instance, surfaceId)`. `now` = local receive clock. */
export function applyTuiFrameEnvelope(
  state: TuiObserveState,
  text: string,
  now: number = Date.now(),
): TuiObserveState {
  const env = parseElanousTermEnvelope(text);
  if (!env || env.method !== 'terminalFrame') return state;
  const { terminalId, frame, instance, at } = env.payload;
  const key = surfaceKey(instance, terminalId);
  const prev = state.get(key);
  if (prev && at < prev.at) return state; // strictly older = out-of-order — ignore
  const next = new Map(state);
  next.set(key, { key, surfaceId: terminalId, frame, instance, at, receivedAt: now });
  return next;
}

/** Drop surfaces whose last frame was received longer than `ttlMs` ago
 *  (dead TUIs — `terminalFrame` has no exit signal). Returns the SAME
 *  reference when nothing expired, so React skips re-render. Prevents the
 *  Map + selector list from growing unbounded as pids churn (review
 *  must-fix · gpt-5.6-sol 2026-07-24). */
export function pruneStaleSurfaces(
  state: TuiObserveState,
  now: number = Date.now(),
  ttlMs: number = TUI_SURFACE_STALE_MS,
): TuiObserveState {
  let expired = false;
  for (const f of state.values()) {
    if (now - f.receivedAt > ttlMs) { expired = true; break; }
  }
  if (!expired) return state;
  const next = new Map<string, TuiObserveFrame>();
  for (const [id, f] of state) {
    if (now - f.receivedAt <= ttlMs) next.set(id, f);
  }
  return next;
}

/** Stable, human-friendly ordering for the surface selector: most recently
 *  active surface on top. Sorts by LOCAL `receivedAt` (not daemon `at`) so
 *  cross-device clock skew can't misorder surfaces from different instances,
 *  with `key` as a deterministic tie-breaker for equal-ms frames (review
 *  should-fix · gpt-5.6-sol). */
export function listObserveSurfaces(state: TuiObserveState): TuiObserveFrame[] {
  return [...state.values()].sort((a, b) => (b.receivedAt - a.receivedAt) || a.key.localeCompare(b.key));
}
