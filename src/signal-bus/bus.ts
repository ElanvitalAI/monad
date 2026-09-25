// MSS M3 Signal Bus — in-process pub/sub. Cascade-zyu W3 Y1.

import { randomBytes } from 'node:crypto';
import {
  tierAtLeast,
  type SignalEmitOptions,
  type SignalEnvelope,
  type SignalSubscription,
  type SignalTier,
} from './types.js';

function newSignalId(): string {
  return `sig:${randomBytes(8).toString('hex')}`;
}

function sourceMatches(glob: string, source: string): boolean {
  if (glob === source) return true;
  if (glob.endsWith('*')) {
    const prefix = glob.slice(0, -1);
    return source.startsWith(prefix);
  }
  return false;
}

export interface SignalBusOptions {
  /** Dedupe window in milliseconds. Default 60_000 (1 minute). */
  dedupeWindowMs?: number;
  /** Max ring buffer size for recent signals (for diagnostic). Default 256. */
  ringCapacity?: number;
}

export class SignalBus {
  private subs: SignalSubscription[] = [];
  private dedupeKeys = new Map<string, number>();
  private ring: SignalEnvelope[] = [];
  private dedupeWindowMs: number;
  private ringCapacity: number;

  constructor(opts: SignalBusOptions = {}) {
    this.dedupeWindowMs = opts.dedupeWindowMs ?? 60_000;
    this.ringCapacity = opts.ringCapacity ?? 256;
  }

  subscribe(sub: SignalSubscription): () => void {
    this.subs.push(sub);
    return () => {
      this.subs = this.subs.filter((s) => s !== sub);
    };
  }

  emit(
    envelope: Omit<SignalEnvelope, 'schema_version' | 'id' | 'ts'>,
    opts: SignalEmitOptions = {},
  ): SignalEnvelope | null {
    const now = Date.now();
    if (envelope.dedupeKey) {
      const last = this.dedupeKeys.get(envelope.dedupeKey);
      if (last !== undefined && now - last < this.dedupeWindowMs) {
        return null;
      }
      this.dedupeKeys.set(envelope.dedupeKey, now);
      this.gcDedupeKeys(now);
    }
    const full: SignalEnvelope = {
      schema_version: 1,
      id: opts.id ?? newSignalId(),
      ts: opts.ts ?? new Date(now).toISOString(),
      ...envelope,
    };
    this.pushRing(full);
    for (const sub of this.subs) {
      if (!sourceMatches(sub.sourceGlob, full.source)) continue;
      if (!tierAtLeast(full.tier, sub.minTier)) continue;
      try {
        const maybe = sub.handler(full);
        if (maybe && typeof (maybe as Promise<void>).catch === 'function') {
          (maybe as Promise<void>).catch(() => { /* sub error never crashes the bus */ });
        }
      } catch { /* sub error never crashes the bus */ }
    }
    return full;
  }

  private pushRing(envelope: SignalEnvelope): void {
    this.ring.push(envelope);
    if (this.ring.length > this.ringCapacity) this.ring.shift();
  }

  private gcDedupeKeys(now: number): void {
    for (const [key, ts] of this.dedupeKeys) {
      if (now - ts >= this.dedupeWindowMs) this.dedupeKeys.delete(key);
    }
  }

  recent(opts: { tier?: SignalTier; limit?: number } = {}): readonly SignalEnvelope[] {
    let snap = [...this.ring];
    if (opts.tier) snap = snap.filter((s) => tierAtLeast(s.tier, opts.tier!));
    if (opts.limit) snap = snap.slice(-opts.limit);
    return snap;
  }

  subscriberCount(): number {
    return this.subs.length;
  }

  clear(): void {
    this.subs = [];
    this.dedupeKeys.clear();
    this.ring = [];
  }
}

let singleton: SignalBus | null = null;

export function signalBus(): SignalBus {
  if (!singleton) singleton = new SignalBus();
  return singleton;
}

export function _resetSignalBus(opts?: SignalBusOptions): SignalBus {
  singleton = new SignalBus(opts);
  return singleton;
}
