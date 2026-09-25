// Phase B-4 (PWA chat streaming · 2026-05-06) — chat-event-bus unit
// contract.
//
// Locks the in-process pub/sub semantics that B-4's multi-tab fanout
// depends on:
//   - per-session topic isolation (subscriber A sees only session A
//     events; session B publishes are dropped on the floor for A)
//   - subscribe/unsubscribe lifecycle (count tracks · disposer
//     removes the listener · double-unsubscribe is safe)
//   - listener throw containment (one bad subscriber does not break
//     the others)
//   - no replay (events emitted before subscribe are not delivered)

import { describe, expect, it } from 'bun:test';

import {
  createChatEventBus,
  type ChatBusEvent,
} from '../src/nexus/api/chat-event-bus';

describe('createChatEventBus — pub/sub semantics', () => {
  it('delivers events to subscribers of the same sessionId', () => {
    const bus = createChatEventBus();
    const seen: ChatBusEvent[] = [];
    const off = bus.subscribe('s-1', (e) => seen.push(e));
    bus.publish('s-1', { event: 'text-delta', data: { delta: 'hi' } });
    bus.publish('s-1', { event: 'turn-end', data: { stopReason: 'end_turn' } });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.event).toBe('text-delta');
    expect(seen[1]!.event).toBe('turn-end');
    off();
  });

  it('isolates events per sessionId — cross-session leakage is impossible', () => {
    const bus = createChatEventBus();
    const aSeen: ChatBusEvent[] = [];
    const bSeen: ChatBusEvent[] = [];
    const offA = bus.subscribe('sess-A', (e) => aSeen.push(e));
    const offB = bus.subscribe('sess-B', (e) => bSeen.push(e));
    bus.publish('sess-A', { event: 'text-delta', data: { delta: 'A1' } });
    bus.publish('sess-B', { event: 'text-delta', data: { delta: 'B1' } });
    bus.publish('sess-A', { event: 'turn-end', data: {} });
    expect(aSeen.map((e) => e.event)).toEqual(['text-delta', 'turn-end']);
    expect(bSeen.map((e) => e.event)).toEqual(['text-delta']);
    offA();
    offB();
  });

  it('does not replay past events to late subscribers', () => {
    const bus = createChatEventBus();
    bus.publish('s-1', { event: 'text-delta', data: { delta: 'past' } });
    const seen: ChatBusEvent[] = [];
    const off = bus.subscribe('s-1', (e) => seen.push(e));
    bus.publish('s-1', { event: 'text-delta', data: { delta: 'fresh' } });
    expect(seen).toHaveLength(1);
    expect((seen[0]!.data as { delta: string }).delta).toBe('fresh');
    off();
  });

  it('unsubscribe removes the listener + frees the topic when count → 0', () => {
    const bus = createChatEventBus();
    const seen: ChatBusEvent[] = [];
    const off = bus.subscribe('s-1', (e) => seen.push(e));
    expect(bus.subscriberCount('s-1')).toBe(1);
    off();
    expect(bus.subscriberCount('s-1')).toBe(0);
    bus.publish('s-1', { event: 'text-delta', data: { delta: 'gone' } });
    expect(seen).toHaveLength(0);
  });

  it('double unsubscribe is a no-op (idempotent disposer)', () => {
    const bus = createChatEventBus();
    const off = bus.subscribe('s-1', () => {});
    off();
    expect(() => off()).not.toThrow();
    expect(bus.subscriberCount('s-1')).toBe(0);
  });

  it('a listener that throws does not break delivery to other listeners', () => {
    const bus = createChatEventBus();
    const goodSeen: number[] = [];
    bus.subscribe('s-1', () => {
      throw new Error('bad listener');
    });
    bus.subscribe('s-1', () => goodSeen.push(1));
    bus.publish('s-1', { event: 'text-delta', data: { delta: 'x' } });
    expect(goodSeen).toEqual([1]);
  });

  it('publishes to topics with no subscribers are silently dropped', () => {
    const bus = createChatEventBus();
    expect(() =>
      bus.publish('orphan', { event: 'text-delta', data: { delta: 'x' } }),
    ).not.toThrow();
    expect(bus.subscriberCount('orphan')).toBe(0);
  });
});
