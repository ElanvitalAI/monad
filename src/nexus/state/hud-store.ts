// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M2 — daemon-native HUD
// segment store.
//
// Mirrors `AgentStatusStore` (src/agent-status/store.ts): keyed Map +
// subscriber Set + redundant-set dedupe. The shape diverges only because
// HUD segments are richer than a 4-state enum — payload carries
// (value · priority · tone · glyph). HUD is **process-wide** (one strip
// shared across all PWA tabs/sessions), so the store does NOT scope by
// sessionId.
//
// Dedupe: set() is a no-op when the incoming payload deep-equals the
// cached one. This keeps the SSE wire idle while the dashboard is
// computing identical HUD segments at 16ms tick (e.g. token-gauge that
// hasn't crossed a percent boundary).

import type { HudSegmentPayload } from '../../feedback/envelope.js';

export type HudStoreEvent =
  | { kind: 'set'; key: string; payload: HudSegmentPayload }
  | { kind: 'clear'; key: string };

export type HudStoreSubscriber = (event: HudStoreEvent) => void;

export interface HudStoreOpts {
  now?: () => number;
}

export class HudStore {
  private readonly segments = new Map<string, HudSegmentPayload>();
  private readonly subs = new Set<HudStoreSubscriber>();
  private readonly now: () => number;
  /** Last-update epoch per key — exposed via getRecord() for diagnostic
   *  surfaces (future) and used by tests to assert dedupe behaviour. */
  private readonly updatedAt = new Map<string, number>();

  constructor(opts: HudStoreOpts = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  get(key: string): HudSegmentPayload | undefined {
    return this.segments.get(key);
  }

  set(payload: HudSegmentPayload): boolean {
    const prev = this.segments.get(payload.key);
    if (prev && payloadsEqual(prev, payload)) return false;
    this.segments.set(payload.key, payload);
    this.updatedAt.set(payload.key, this.now());
    for (const cb of this.subs) cb({ kind: 'set', key: payload.key, payload });
    return true;
  }

  clear(key: string): boolean {
    if (!this.segments.has(key)) return false;
    this.segments.delete(key);
    this.updatedAt.delete(key);
    for (const cb of this.subs) cb({ kind: 'clear', key });
    return true;
  }

  clearAll(): void {
    const keys = [...this.segments.keys()];
    this.segments.clear();
    this.updatedAt.clear();
    for (const key of keys) {
      for (const cb of this.subs) cb({ kind: 'clear', key });
    }
  }

  subscribe(cb: HudStoreSubscriber): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  /** Snapshot priority-sorted segments — used by /v1/diag surfaces and
   *  by the M3 dashboard-mirror's initial sync path. */
  snapshot(): HudSegmentPayload[] {
    return [...this.segments.values()].sort(
      (a, b) => (a.priority ?? 50) - (b.priority ?? 50),
    );
  }

  /** Mirrors AgentStatusStore.entries — diagnostic enumeration. */
  entries(): Array<[string, HudSegmentPayload]> {
    return [...this.segments.entries()];
  }

  /** Last-update ms epoch for key. undefined when absent. */
  getUpdatedAt(key: string): number | undefined {
    return this.updatedAt.get(key);
  }
}

function payloadsEqual(a: HudSegmentPayload, b: HudSegmentPayload): boolean {
  return (
    a.key === b.key
    && a.value === b.value
    && (a.priority ?? 50) === (b.priority ?? 50)
    && a.tone === b.tone
    && a.glyph === b.glyph
  );
}
