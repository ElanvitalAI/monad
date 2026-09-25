// Daemon-side HUD writer for chat-only PWA mode (2026-05-13 · PR-B1).
//
// **Why**: Until now every HUD segment writer lived inside the
// dashboard process — `src/dashboard/index.ts` ran the 1Hz
// `chatHudTicker`, the SSH/agent-activity setSegment sites, the
// reasoning refresher. When a user boots only `monad nexus run`
// (daemon + PWA static export, no TUI), the daemon's HudStore
// stayed empty and PWA `<ChatHud>` rendered nothing — the entire
// strip silently absent.
//
// **What**: Two-step writer keyed on `state.hudStore` (already
// populated by `runNexus` boot). Each daemon prompt turn calls
// `pushTokenGaugeFromTurn` at turn-end:
//
//   1. `recordTurn(...)` updates the daemon's `getSessionMetrics()`
//      singleton (same one the dashboard reads). After it returns,
//      `lastContextUsed` / `lastContextMax` reflect the just-finished
//      turn — model lookup handles the contextWindow per model.
//   2. The metrics snapshot is rendered to a `token-gauge` segment
//      (`ctx ▇ 87%`) with the same priority (5) the dashboard
//      writer uses (`src/chat/hud-segments-wire.ts`), so the M2
//      HudStore dedupe collapses dashboard + daemon writes when
//      both are running.
//
// Future segments (variant · model · workspace) follow the same
// shape — each is a small helper that reads from a daemon-side
// state source and calls `hudStore.set`.

import type { HudStore } from '../state/hud-store.js';
import type { HudSegmentPayload } from '../../feedback/envelope.js';
import {
  recordTurn,
  getSessionMetrics,
  type RecordTurnInput,
} from '../../status/metrics.js';
import {
  renderTokenGauge,
  resolveGaugeTone,
  type HudGaugeTone,
} from '../../chat/hud-render.js';

/** Key + priority MUST match `src/chat/hud-segments-wire.ts` so the
 *  daemon writer and the dashboard writer collapse into one segment
 *  via `HudStore.set`'s deep-equal dedupe (M2). */
export const TOKEN_GAUGE_SEGMENT_KEY = 'token-gauge';
export const TOKEN_GAUGE_SEGMENT_PRIORITY = 5;

const GAUGE_DEFAULT_HUD_CFG = {
  gaugeWarnRatio: 0.7,
  gaugeDangerRatio: 0.9,
} as const;

const GAUGE_TONE_MAP: Record<HudGaugeTone, HudSegmentPayload['tone']> = {
  normal: 'normal',
  warn: 'warn',
  danger: 'danger',
};

export interface PushTokenGaugeOpts {
  /** Provider model id (e.g. 'claude-opus-4-6', 'grok-4'). Used by
   *  `recordTurn` for cost + context-window lookup. Pass undefined
   *  when the daemon doesn't track the active provider — the writer
   *  still emits a segment using the metrics fallback context size. */
  model?: string;
  /** Text the user sent to the LLM. Char-count is divided by 4 inside
   *  `recordTurn` when `usage.inputTokens` isn't supplied. */
  inputText?: string;
  /** Text the model produced. Same estimate path as `inputText`. */
  outputText?: string;
  /** Wall-clock seconds the turn took. Optional — defaults to 0
   *  (metrics still records, just with zero throughput). */
  seconds?: number;
  /** HUD config knobs. Defaults match `CHAT_DEFAULTS.rendering.hud`
   *  (warn 70% · danger 90%). */
  gaugeCfg?: { gaugeWarnRatio: number; gaugeDangerRatio: number };
}

/** Update session metrics + publish the `token-gauge` HUD segment.
 *  Idempotent via HudStore.set deep-equal dedupe — safe to call after
 *  every turn even when the ratio hasn't budged. */
export function pushTokenGaugeFromTurn(
  hudStore: HudStore,
  opts: PushTokenGaugeOpts,
): void {
  const recordInput: RecordTurnInput = {
    model: opts.model ?? 'unknown',
    seconds: opts.seconds ?? 0,
    ...(opts.inputText !== undefined ? { estimatedPromptText: opts.inputText } : {}),
    ...(opts.outputText !== undefined ? { estimatedOutputText: opts.outputText } : {}),
  };
  recordTurn(recordInput);
  const metrics = getSessionMetrics();
  const used = metrics.lastContextUsed;
  const max = metrics.lastContextMax;
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) {
    // Metrics not yet primed — leave the segment alone rather than
    // pushing a misleading "0%" gauge.
    return;
  }
  const cfg = opts.gaugeCfg ?? GAUGE_DEFAULT_HUD_CFG;
  const ratio = Math.max(0, Math.min(1, used / max));
  const tone = GAUGE_TONE_MAP[resolveGaugeTone(ratio, cfg)] ?? 'normal';
  // `renderTokenGauge` returns the same ANSI-wrapped string the
  // dashboard writer produces — the M3 dashboard mirror would strip
  // ANSI before forwarding, but we're skipping the mirror here so we
  // emit the plain-text variant directly.
  const valueWithAnsi = renderTokenGauge(used, max, cfg);
  // Surface-level ANSI strip — dashboard mirror does this in M3 for
  // its forwarder; we replicate so the PWA renderer receives a clean
  // token string identical to what M3 would have produced.
  const value = valueWithAnsi.replace(/\x1b\[[0-9;]*m/g, '');
  const payload: HudSegmentPayload = {
    key: TOKEN_GAUGE_SEGMENT_KEY,
    value,
    priority: TOKEN_GAUGE_SEGMENT_PRIORITY,
    tone,
  };
  hudStore.set(payload);
}
