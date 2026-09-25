// W5 U4 · Patcher bridge sink — buffer + classify hint for Y3 Patcher drain.
// Cf. PLAN-user-intent-logging-2026-05-12.md §4.3 Sink 3 + RESEARCH §9.5
// (KGS classification hint only; full card synthesis lives in Y3).
//
// Y3 Patcher subscribes via `subscribe()` or polls `drainBatch()` when it
// wakes from idle/threshold trigger. Hint maps UserIntent layer → coarse
// KGS card kind so Patcher's LLM prompt can be specialized.

import type { UserIntentSink } from '../logger.js';
import type { UserIntentEvent, UserIntentLayer } from '../types.js';

/** Coarse classification hint · Patcher refines into KGS kind v2. */
export type PatcherCardKindHint =
  | 'utterance'       // raw user speech / text · later → retro/playbook/case
  | 'interaction'     // gesture / navigation / selection · UX trail
  | 'context-signal'  // ambient / device_state / biometric threshold
  | 'system-event';   // system layer (boot / shutdown / config change)

export interface PatcherBridgeInput {
  event: UserIntentEvent;
  cardKindHint: PatcherCardKindHint;
}

export interface PatcherBridgeOpts {
  /** Auto-flush threshold; subscriber callbacks fire once queue reaches this size. */
  batchSize?: number;
  /** Hard cap; oldest events evicted when exceeded. Default 10_000. */
  capacity?: number;
}

export function classifyForPatcher(layer: UserIntentLayer): PatcherCardKindHint {
  switch (layer) {
    case 'utterance':
      return 'utterance';
    case 'gesture':
    case 'navigation':
    case 'selection':
      return 'interaction';
    case 'ambient':
    case 'device_state':
      return 'context-signal';
    case 'system':
      return 'system-event';
  }
}

export type PatcherSubscriber = (batch: PatcherBridgeInput[]) => void;

export class PatcherBridge {
  private queue: PatcherBridgeInput[] = [];
  private subs: PatcherSubscriber[] = [];
  private readonly batchSize: number;
  private readonly capacity: number;

  constructor(opts: PatcherBridgeOpts = {}) {
    this.batchSize = Math.max(1, opts.batchSize ?? 50);
    this.capacity = Math.max(1, opts.capacity ?? 10_000);
  }

  asSink(): UserIntentSink {
    return {
      name: 'patcher-bridge',
      write: (ev) => { this.enqueue(ev); },
    };
  }

  enqueue(event: UserIntentEvent): void {
    const input: PatcherBridgeInput = { event, cardKindHint: classifyForPatcher(event.intent.layer) };
    this.queue.push(input);
    if (this.queue.length > this.capacity) {
      this.queue.splice(0, this.queue.length - this.capacity);
    }
    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  subscribe(fn: PatcherSubscriber): () => void {
    this.subs.push(fn);
    return () => { this.subs = this.subs.filter((s) => s !== fn); };
  }

  pendingCount(): number {
    return this.queue.length;
  }

  drainBatch(): PatcherBridgeInput[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  flush(): void {
    if (this.queue.length === 0 || this.subs.length === 0) return;
    const batch = this.drainBatch();
    for (const sub of this.subs) {
      try { sub(batch); } catch { /* sink contract: subscriber error must not break logger */ }
    }
  }
}
