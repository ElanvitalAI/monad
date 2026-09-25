// ── HUD — one-line status bar (mode · progress · tokens · warnings) ──
// Lives between the 3-pane grid and the log pane. Segments are owned by
// dashboard + (later) plugins via setSegment(key, value); rendering is a
// pure join + tail-ellipsize to fit the terminal width.

import { C, visibleWidth, truncate } from '../tui.js';

export interface HudSegment {
  /** Ordering priority — lower renders first (left). Default 50. */
  priority?: number;
  /** Pre-formatted segment content (may include ANSI colors). */
  value: string;
}

/** PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M3 — observer hook.
 *  set/clear emit one event so the dashboard HUD mirror can forward
 *  segments to the daemon's HudStore via POST /v1/hud-segment. The
 *  hook is a no-op when no subscribers are attached (zero-cost when
 *  the mirror is off — TUI-only mode). */
export type HudSubscriber = (event:
  | { kind: 'set'; key: string; segment: HudSegment }
  | { kind: 'clear'; key: string }
) => void;

export interface HudState {
  segments: Record<string, HudSegment>;
  /** Subscribers attached by `subscribe(hud, cb)`. Lazy-init via the
   *  factory so existing test fixtures that build HudState by hand
   *  (without the factory) keep working — set/clear treat missing
   *  subscribers as "no observers". */
  subscribers?: Set<HudSubscriber>;
}

export function createHud(): HudState {
  return { segments: {}, subscribers: new Set() };
}

export function setSegment(hud: HudState, key: string, value: string, priority?: number): void {
  const existing = hud.segments[key];
  const finalPriority = priority ?? existing?.priority ?? 50;
  // M5 (PLAN-chat-hud-multi-surface-port-2026-05-13 §4) — dedupe
  // identical writes so redraw-tied refreshes (e.g. token-gauge on
  // every draw tick) don't spam M3 mirror's POST /v1/hud-segment.
  // Matches the HudStore.set deep-equal dedupe on the daemon side.
  if (existing && existing.value === value && existing.priority === finalPriority) {
    return;
  }
  const segment: HudSegment = { value, priority: finalPriority };
  hud.segments[key] = segment;
  if (hud.subscribers) {
    for (const cb of hud.subscribers) {
      try { cb({ kind: 'set', key, segment }); } catch { /* swallow — observer boundary */ }
    }
  }
}

export function clearSegment(hud: HudState, key: string): void {
  if (!(key in hud.segments)) return;
  delete hud.segments[key];
  if (hud.subscribers) {
    for (const cb of hud.subscribers) {
      try { cb({ kind: 'clear', key }); } catch { /* swallow */ }
    }
  }
}

/** Attach a subscriber. Returns idempotent unsubscribe. */
export function subscribe(hud: HudState, cb: HudSubscriber): () => void {
  if (!hud.subscribers) hud.subscribers = new Set();
  hud.subscribers.add(cb);
  return () => {
    hud.subscribers?.delete(cb);
  };
}

const SEP = C.muted(' · ');

/** Render the HUD as a single line capped at `width` columns. */
export function renderHud(state: HudState, width: number): string {
  const entries = Object.entries(state.segments)
    .map(([key, seg]) => ({ key, ...seg }))
    .sort((a, b) => (a.priority! - b.priority!) || a.key.localeCompare(b.key));

  if (entries.length === 0) return '';

  const joined = entries.map(e => e.value).join(SEP);
  if (visibleWidth(joined) <= width) return joined;
  return truncate(joined, width);
}
