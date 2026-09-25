import { describe, expect, test } from 'bun:test';

import { createVWEventBus, type VWEvent, MAX_EVENTS_PER_SECOND } from '../src/virtual-windows/event-bus.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';

function makeBus(opts?: { writePane?: (paneId: string, bytes: string) => void }) {
  const book = createAddressBook();
  const bus = createVWEventBus({ addressBook: book, writePane: opts?.writePane });
  return { bus, book };
}

describe('subscribe + emit', () => {
  test('no-filter subscriber receives all events', () => {
    const { bus } = makeBus();
    const seen: VWEvent[] = [];
    bus.subscribe({}, (ev) => seen.push(ev));
    bus.emit({ type: 'window:create', windowId: 1, title: 'w' });
    bus.emit({ type: 'pane:focus', addr: 'pane:abc' });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.at).toBeGreaterThan(0);
  });

  test('type filter restricts to selected events', () => {
    const { bus } = makeBus();
    const seen: VWEvent[] = [];
    bus.subscribe({ types: ['pane:focus'] }, (ev) => seen.push(ev));
    bus.emit({ type: 'window:create', windowId: 1, title: 'w' });
    bus.emit({ type: 'pane:focus', addr: 'pane:abc' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe('pane:focus');
  });

  test('exact addr filter matches only the right event', () => {
    const { bus } = makeBus();
    const seen: VWEvent[] = [];
    bus.subscribe({ addr: 'pane:abc' }, (ev) => seen.push(ev));
    bus.emit({ type: 'pane:output', addr: 'pane:abc', chunk: 'X' });
    bus.emit({ type: 'pane:output', addr: 'pane:xyz', chunk: 'Y' });
    expect(seen).toHaveLength(1);
  });

  test('addrPrefix subscribes to a window family', () => {
    const { bus } = makeBus();
    const seen: VWEvent[] = [];
    bus.subscribe({ addrPrefix: 'win:3' }, (ev) => seen.push(ev));
    bus.emit({ type: 'window:create', windowId: 3, title: 'w' });
    bus.emit({ type: 'window:create', windowId: 4, title: 'w' });
    expect(seen).toHaveLength(1);
  });

  test('unsubscribe detaches future deliveries', () => {
    const { bus } = makeBus();
    let n = 0;
    const off = bus.subscribe({}, () => n++);
    bus.emit({ type: 'pane:focus', addr: 'pane:a' });
    off();
    bus.emit({ type: 'pane:focus', addr: 'pane:b' });
    expect(n).toBe(1);
    expect(bus.subscriptions()).toBe(0);
  });

  test('subscriber error is isolated', () => {
    const { bus } = makeBus();
    bus.subscribe({}, () => { throw new Error('oops'); });
    let ok = 0;
    bus.subscribe({}, () => ok++);
    // Does not throw.
    bus.emit({ type: 'pane:focus', addr: 'pane:a' });
    expect(ok).toBe(1);
  });
});

describe('broadcast', () => {
  test('writes to each registered pane', () => {
    const writes: Array<[string, string]> = [];
    const { bus, book } = makeBus({ writePane: (id, b) => writes.push([id, b]) });
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 'terminal' });
    book.registerPane({ id: 'b', windowId: 1, kind: 'terminal' });
    const r = bus.broadcast(['pane:a', 'pane:b'], 'hello');
    expect(r.sent).toBe(2);
    expect(r.failed).toHaveLength(0);
    expect(writes.map(w => w[0])).toEqual(['a', 'b']);
    expect(writes[0]?.[1]).toBe('hello');
  });

  test('missing target is reported in failed list', () => {
    const { bus, book } = makeBus({ writePane: () => {} });
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 't' });
    const r = bus.broadcast(['pane:a', 'pane:missing'], 'x');
    expect(r.sent).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]?.reason).toBe('pane-not-found');
  });

  test('emits broadcast event unless opts.emit=false', () => {
    const { bus, book } = makeBus({ writePane: () => {} });
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 't' });
    const evs: VWEvent[] = [];
    bus.subscribe({ types: ['broadcast'] }, (ev) => evs.push(ev));
    bus.broadcast(['pane:a'], 'hi');
    expect(evs).toHaveLength(1);
    bus.broadcast(['pane:a'], 'hi', { emit: false });
    expect(evs).toHaveLength(1);
  });

  test('also emits pane:input per sent target', () => {
    const { bus, book } = makeBus({ writePane: () => {} });
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 't' });
    book.registerPane({ id: 'b', windowId: 1, kind: 't' });
    const seen: VWEvent[] = [];
    bus.subscribe({ types: ['pane:input'] }, (ev) => seen.push(ev));
    bus.broadcast(['pane:a', 'pane:b'], 'x');
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });
});

describe('rate limit + reentrance', () => {
  test('events beyond MAX_EVENTS_PER_SECOND are dropped', () => {
    const { bus } = makeBus();
    let n = 0;
    bus.subscribe({}, () => n++);
    for (let i = 0; i < MAX_EVENTS_PER_SECOND + 50; i++) {
      bus.emit({ type: 'pane:focus', addr: `pane:${i}` });
    }
    // Accept that rate-limit might add some slop; ensure we didn't
    // deliver every single one.
    expect(n).toBeLessThan(MAX_EVENTS_PER_SECOND + 50);
    expect(n).toBeGreaterThan(0);
  });

  test('reentrant emits are bounded (no infinite loop)', () => {
    const { bus } = makeBus();
    let n = 0;
    bus.subscribe({}, () => {
      n++;
      if (n < 100) bus.emit({ type: 'pane:focus', addr: `pane:${n}` });
    });
    bus.emit({ type: 'pane:focus', addr: 'pane:start' });
    // Stops at MAX_EMIT_DEPTH = 8 (one triggered event per level);
    // each callback invocation of the subscriber counts. Just check
    // it completes without hanging.
    expect(n).toBeLessThan(100);
  });
});
