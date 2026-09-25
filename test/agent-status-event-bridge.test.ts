// NEXUS · AgentStatusStore ↔ NexusEventBus bridge tests
// (Rich-dev-feedback opportunistic followup §6.2 #3 · 2026-05-13)
//
// Wire invariants:
//  1. Store.set(...) that produces a state change publishes one
//     `agent.status` NexusEvent with detail = the new record.
//  2. Redundant set (no change) emits zero events (matches the
//     store's own dedupe).
//  3. Multiple agents fan out independently — each event carries the
//     agentId so subscribers can route per-agent.
//  4. lastEvent is included in detail when the store stamp had one,
//     omitted otherwise (the wire keeps the schema minimal).
//  5. updatedAt mirrors record.updatedAt — not Date.now() at publish
//     time. This lets downstream consumers correlate envelope ts
//     with the originating event without clock drift.
//  6. Disposer detaches the bridge subscriber without affecting
//     other store subscribers.

import { describe, expect, test } from 'bun:test';

import { AgentStatusStore } from '../src/agent-status/store.js';
import { wireAgentStatusEvents } from '../src/nexus/api/agent-status-event-bridge.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import type { NexusEvent } from '../src/nexus/state/state.js';

function makeRig(now?: () => number): {
  store: AgentStatusStore;
  bus: NexusEventBus;
  events: NexusEvent[];
  dispose: () => void;
} {
  const store = new AgentStatusStore(now ? { now } : {});
  const bus = new NexusEventBus();
  const events: NexusEvent[] = [];
  bus.subscribe((ev) => events.push(ev), ['agent.status']);
  const dispose = wireAgentStatusEvents(bus, store);
  return { store, bus, events, dispose };
}

describe('wireAgentStatusEvents · transition fan-out', () => {
  test('store.set publishes one agent.status event with the new record', () => {
    let t = 1_700_000_000_000;
    const { store, events } = makeRig(() => t);
    store.set('claude-1', 'working', 'tool-call');
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe('agent.status');
    expect(ev.ts).toBe(1_700_000_000_000);
    expect(ev.detail).toEqual({
      agentId: 'claude-1',
      status: 'working',
      updatedAt: 1_700_000_000_000,
      lastEvent: 'tool-call',
    });
  });

  test('omits lastEvent in detail when the record has none', () => {
    const { store, events } = makeRig();
    store.set('codex-1', 'awaiting');
    expect(events).toHaveLength(1);
    const detail = events[0]!.detail!;
    expect(detail.lastEvent).toBeUndefined();
    expect('lastEvent' in detail).toBe(false);
  });

  test('redundant set (no state change) emits zero events', () => {
    const { store, events } = makeRig();
    store.set('agent-X', 'working', 'tool-call');
    store.set('agent-X', 'working', 'tool-call'); // same status + lastEvent
    expect(events).toHaveLength(1);
  });

  test('parallel agents fan out independently by agentId', () => {
    const { store, events } = makeRig();
    store.set('claude-1', 'working');
    store.set('codex-2', 'working');
    store.set('claude-1', 'done');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.detail?.agentId)).toEqual([
      'claude-1',
      'codex-2',
      'claude-1',
    ]);
    expect(events.map((e) => e.detail?.status)).toEqual([
      'working',
      'working',
      'done',
    ]);
  });

  test('updatedAt mirrors the record clock — not Date.now()', () => {
    let t = 5_000_000;
    const { store, events } = makeRig(() => t);
    store.set('agent-Y', 'working');
    t = 5_001_000;
    store.set('agent-Y', 'done', 'turn-end');
    expect(events[0]!.detail?.updatedAt).toBe(5_000_000);
    expect(events[0]!.ts).toBe(5_000_000);
    expect(events[1]!.detail?.updatedAt).toBe(5_001_000);
    expect(events[1]!.ts).toBe(5_001_000);
  });
});

describe('wireAgentStatusEvents · disposer', () => {
  test('disposer stops bus publishes but keeps the store usable', () => {
    const { store, events, dispose } = makeRig();
    store.set('agent-Z', 'working');
    expect(events).toHaveLength(1);
    dispose();
    store.set('agent-Z', 'done');
    expect(events).toHaveLength(1);
    // Store itself still works — other subscribers (dashboard widgets)
    // are unaffected by the bridge teardown.
    let widgetSawIt = 0;
    store.subscribe(() => widgetSawIt++);
    store.set('agent-Z', 'awaiting');
    expect(widgetSawIt).toBe(1);
  });

  test('disposer is idempotent', () => {
    const { dispose } = makeRig();
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

describe('wireAgentStatusEvents · bus subscriber filter compatibility', () => {
  test('bus subscribers with empty prefix list see agent.status too', () => {
    const store = new AgentStatusStore();
    const bus = new NexusEventBus();
    wireAgentStatusEvents(bus, store);
    const all: NexusEvent[] = [];
    bus.subscribe((ev) => all.push(ev)); // no prefix filter
    store.set('agent-A', 'working');
    expect(all).toHaveLength(1);
    expect(all[0]!.kind).toBe('agent.status');
  });

  test('bus subscribers with a non-matching prefix do NOT see agent.status', () => {
    const store = new AgentStatusStore();
    const bus = new NexusEventBus();
    wireAgentStatusEvents(bus, store);
    const filtered: NexusEvent[] = [];
    bus.subscribe((ev) => filtered.push(ev), ['workflow.']);
    store.set('agent-A', 'working');
    expect(filtered).toHaveLength(0);
  });
});
