// Watchdog — BCO Phase D3.
//
// Browser Context Organ 의 "감각기관" 실체화 레이어. CDP transport 가
// 받는 이벤트 (`Page.loadEventFired`, `Runtime.exceptionThrown`,
// `Network.requestWillBeSent`, ...) 를 구독 → ring buffer 에 기록 →
// 필터된 listener 로 fan-out. Research 문서 §3.1 "Event-driven
// watchdog" + bubus 패턴의 TypeScript 이식.
//
// 사용:
//   const wd = createWatchdog(transport);
//   await wd.enableDomain('Page');   // Page.enable 발사
//   const off = wd.subscribe('Page.*', (evt) => { ... });
//   const recent = wd.recent(20);
//   off();
//   wd.close();
//
// 이 모듈은 client 의 `transport.on()` 만 의존하므로 fake transport
// 로 단위 테스트 가능 (실제 Chrome 없이도).

import type { CdpEventListener, CdpIncomingEvent, CdpTransport } from './client.js';

export interface WatchdogEvent extends CdpIncomingEvent {
  /** Wall-clock timestamp at ingest (monotonic within session). */
  ts: number;
  /** Monotonic id (0-based, resets on `clear()`). */
  seq: number;
}

export interface WatchdogStats {
  totalIngested: number;
  bufferSize: number;
  capacity: number;
  byDomain: Record<string, number>;
  listeners: number;
}

export interface WatchdogOpts {
  /** Ring buffer size. Default 100. */
  bufferSize?: number;
  /** Clock injection for tests (default `Date.now`). */
  now?: () => number;
}

export type WatchdogPattern = string; // 'Page.loadEventFired' | 'Page.*' | '*'

export interface Watchdog {
  /** Enable a CDP domain so the browser starts emitting its events.
   *  Equivalent to `transport.send('Page.enable')`. */
  enableDomain(domain: string): Promise<void>;
  /** Fire listeners matching `pattern`. Returns unsubscribe fn. */
  subscribe(pattern: WatchdogPattern, listener: (ev: WatchdogEvent) => void): () => void;
  /** Last `n` events (most recent first). Default: all buffered. */
  recent(n?: number): WatchdogEvent[];
  /** Drop all buffered events + reset seq. Does not unsubscribe. */
  clear(): void;
  /** Snapshot of counters. */
  stats(): WatchdogStats;
  /** Stop receiving events. Idempotent. */
  close(): void;
}

interface Subscription {
  id: number;
  pattern: WatchdogPattern;
  listener: (ev: WatchdogEvent) => void;
}

/** Matches pattern against an event method. Supports:
 *  - `'*'`           — any event
 *  - `'Domain.*'`    — any event from a domain
 *  - `'Domain.name'` — exact match
 */
export function matchesPattern(pattern: WatchdogPattern, method: string): boolean {
  if (pattern === '*') return true;
  if (pattern === method) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1); // keep the trailing dot
    return method.startsWith(prefix);
  }
  return false;
}

export function createWatchdog(transport: CdpTransport, opts: WatchdogOpts = {}): Watchdog {
  const capacity = Math.max(1, Math.floor(opts.bufferSize ?? 100));
  const now = opts.now ?? (() => Date.now());

  // Ring buffer — events[head] is oldest, events[head+size-1] is newest.
  const events: WatchdogEvent[] = [];
  let head = 0;
  let size = 0;

  let totalIngested = 0;
  const byDomain = new Map<string, number>();

  const subs = new Map<number, Subscription>();
  let nextSubId = 1;

  let seq = 0;
  let closed = false;

  function push(ev: CdpIncomingEvent) {
    const wd: WatchdogEvent = { ...ev, ts: now(), seq: seq++ };

    if (size < capacity) {
      events.push(wd);
      size++;
    } else {
      events[head] = wd;
      head = (head + 1) % capacity;
    }
    totalIngested++;

    const domain = ev.method.split('.', 1)[0] ?? '';
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);

    for (const sub of subs.values()) {
      if (!matchesPattern(sub.pattern, ev.method)) continue;
      try { sub.listener(wd); } catch { /* listener errors don't crash ingest */ }
    }
  }

  // Subscribe to all transport events. `'*'` relies on the client's
  // catch-all wildcard.
  const rawListener: CdpEventListener = (ev) => push(ev);
  const detach = transport.on?.('*', rawListener) ?? (() => {});

  return {
    async enableDomain(domain) {
      if (closed) throw new Error('watchdog closed');
      await transport.send(`${domain}.enable`);
    },
    subscribe(pattern, listener) {
      if (closed) return () => {};
      const id = nextSubId++;
      subs.set(id, { id, pattern, listener });
      return () => { subs.delete(id); };
    },
    recent(n) {
      // Materialize the ring into oldest-first order, then take tail.
      const out: WatchdogEvent[] = [];
      for (let i = 0; i < size; i++) {
        const idx = (head + i) % capacity;
        const e = events[idx];
        if (e) out.push(e);
      }
      const limit = n === undefined ? out.length : Math.max(0, Math.floor(n));
      // Most-recent-first for easier consumption.
      return out.slice(-limit).reverse();
    },
    clear() {
      events.length = 0;
      head = 0;
      size = 0;
      seq = 0;
      // totalIngested/byDomain are lifetime counters; not reset.
    },
    stats() {
      const by: Record<string, number> = {};
      for (const [k, v] of byDomain) by[k] = v;
      return {
        totalIngested,
        bufferSize: size,
        capacity,
        byDomain: by,
        listeners: subs.size,
      };
    },
    close() {
      if (closed) return;
      closed = true;
      try { detach(); } catch { /* ignore */ }
      subs.clear();
    },
  };
}
