import { describe, test, expect, beforeEach } from 'bun:test';
import {
  createElementEventBus,
  createElementStateStore,
  attachStateStoreToBus,
  type ElementEvent,
} from '../src/element-registry/index.js';

function mkEvent(partial: Partial<ElementEvent> & Pick<ElementEvent, 'kind' | 'id' | 'type'>): ElementEvent {
  return {
    ts: partial.ts ?? Date.now(),
    addr: partial.addr ?? `${partial.kind === 'pty' ? 'pty' : 'win'}:${partial.id}`,
    payload: partial.payload,
    ...partial,
  };
}

describe('element-event-bus', () => {
  test('subscribers receive published events in order', () => {
    const bus = createElementEventBus(16);
    const seen: string[] = [];
    bus.subscribe(ev => seen.push(`${ev.kind}:${ev.id}:${ev.type}`));
    bus.publish(mkEvent({ kind: 'pty', id: 'a', type: 'create' }));
    bus.publish(mkEvent({ kind: 'pty', id: 'a', type: 'output' }));
    bus.publish(mkEvent({ kind: 'pty', id: 'a', type: 'exit' }));
    expect(seen).toEqual(['pty:a:create', 'pty:a:output', 'pty:a:exit']);
  });

  test('ring buffer caps at capacity', () => {
    const bus = createElementEventBus(3);
    for (let i = 0; i < 10; i++) bus.publish(mkEvent({ kind: 'pty', id: String(i), type: 'create' }));
    expect(bus.size()).toBe(3);
    expect(bus.tail().map(e => e.id)).toEqual(['9', '8', '7']);
  });

  test('tail filters by kind/type/addr/sinceTs', () => {
    const bus = createElementEventBus();
    const t0 = 1_000_000;
    bus.publish(mkEvent({ ts: t0,     kind: 'pty',    id: 'a', type: 'create' }));
    bus.publish(mkEvent({ ts: t0 + 1, kind: 'window', id: '1', type: 'create' }));
    bus.publish(mkEvent({ ts: t0 + 2, kind: 'pty',    id: 'a', type: 'output' }));
    bus.publish(mkEvent({ ts: t0 + 3, kind: 'pty',    id: 'b', type: 'create' }));

    expect(bus.tail({ kinds: ['pty'] }).map(e => e.id)).toEqual(['b', 'a', 'a']);
    expect(bus.tail({ types: ['create'] }).map(e => `${e.kind}:${e.id}`))
      .toEqual(['pty:b', 'window:1', 'pty:a']);
    expect(bus.tail({ addr: 'pty:a' }).map(e => e.type)).toEqual(['output', 'create']);
    expect(bus.tail({ sinceTs: t0 + 2 }).map(e => e.id)).toEqual(['b', 'a']);
    expect(bus.tail({ limit: 2 }).length).toBe(2);
  });

  test('throwing subscriber does not break fan-out', () => {
    const bus = createElementEventBus();
    const seen: string[] = [];
    bus.subscribe(() => { throw new Error('bad'); });
    bus.subscribe(ev => seen.push(ev.id));
    bus.publish(mkEvent({ kind: 'pty', id: 'ok', type: 'create' }));
    expect(seen).toEqual(['ok']);
  });
});

describe('element-state-store', () => {
  let store = createElementStateStore();

  beforeEach(() => {
    store = createElementStateStore();
  });

  test('apply creates entry, delete flips alive=false', () => {
    store.apply(mkEvent({ ts: 100, kind: 'pty', id: 'a', type: 'create' }));
    expect(store.get('pty', 'a')?.alive).toBe(true);
    store.apply(mkEvent({ ts: 200, kind: 'pty', id: 'a', type: 'delete' }));
    expect(store.get('pty', 'a')?.alive).toBe(false);
    expect(store.get('pty', 'a')?.lastEventType).toBe('delete');
  });

  test('output events keep alive=true and refresh timestamp', () => {
    store.apply(mkEvent({ ts: 100, kind: 'pty', id: 'a', type: 'create' }));
    store.apply(mkEvent({ ts: 500, kind: 'pty', id: 'a', type: 'output' }));
    const e = store.get('pty', 'a')!;
    expect(e.alive).toBe(true);
    expect(e.lastUpdatedAt).toBe(500);
    expect(e.lastEventType).toBe('output');
  });

  test('list filters by kind', () => {
    store.apply(mkEvent({ ts: 1, kind: 'pty', id: 'a', type: 'create' }));
    store.apply(mkEvent({ ts: 2, kind: 'window', id: '1', type: 'create' }));
    expect(store.list('pty')).toHaveLength(1);
    expect(store.list()).toHaveLength(2);
  });

  test('staleness reports ms since last update', () => {
    store.apply(mkEvent({ ts: 1_000, kind: 'pty', id: 'a', type: 'create' }));
    expect(store.staleness('pty', 'a', 5_000)).toBe(4_000);
    expect(store.staleness('pty', 'missing', 5_000)).toBeUndefined();
  });

  test('attachStateStoreToBus plumbs publish → apply', () => {
    const bus = createElementEventBus();
    attachStateStoreToBus(bus, store);
    bus.publish(mkEvent({ ts: 42, kind: 'pty', id: 'x', type: 'create' }));
    expect(store.get('pty', 'x')?.alive).toBe(true);
    bus.publish(mkEvent({ ts: 43, kind: 'pty', id: 'x', type: 'exit' }));
    expect(store.get('pty', 'x')?.alive).toBe(false);
  });
});
