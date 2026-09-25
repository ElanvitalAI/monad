import { describe, expect, test } from 'bun:test';

import type { CdpEventListener, CdpIncomingEvent, CdpTransport } from '../src/browser-cdp/client.js';
import { createWatchdog, matchesPattern } from '../src/browser-cdp/watchdog.js';

function fakeTransport() {
  const listeners = new Map<string, Set<CdpEventListener>>();
  const sent: Array<{ method: string; params?: unknown }> = [];

  const transport: CdpTransport = {
    async send(method, params) {
      sent.push({ method, params });
      return {};
    },
    on(method, listener) {
      let s = listeners.get(method);
      if (!s) { s = new Set(); listeners.set(method, s); }
      s.add(listener);
      return () => { s!.delete(listener); };
    },
    close() { listeners.clear(); },
  };

  function emit(event: CdpIncomingEvent) {
    for (const key of [event.method, '*']) {
      const set = listeners.get(key);
      if (!set) continue;
      for (const l of set) l(event);
    }
  }

  return { transport, sent, emit, listeners };
}

describe('matchesPattern', () => {
  test('wildcard * matches any', () => {
    expect(matchesPattern('*', 'Page.loadEventFired')).toBe(true);
    expect(matchesPattern('*', 'Network.requestWillBeSent')).toBe(true);
  });
  test('domain prefix Page.* matches only Page', () => {
    expect(matchesPattern('Page.*', 'Page.loadEventFired')).toBe(true);
    expect(matchesPattern('Page.*', 'Page.frameNavigated')).toBe(true);
    expect(matchesPattern('Page.*', 'Network.requestWillBeSent')).toBe(false);
  });
  test('exact match is strict', () => {
    expect(matchesPattern('Page.loadEventFired', 'Page.loadEventFired')).toBe(true);
    expect(matchesPattern('Page.loadEventFired', 'Page.frameNavigated')).toBe(false);
  });
});

describe('createWatchdog', () => {
  test('ingests events + ring buffer evicts oldest', () => {
    const f = fakeTransport();
    let clock = 1000;
    const wd = createWatchdog(f.transport, { bufferSize: 3, now: () => clock++ });

    for (let i = 0; i < 5; i++) {
      f.emit({ method: 'Page.loadEventFired', params: { n: i } });
    }

    const recent = wd.recent();
    expect(recent).toHaveLength(3);
    // Most-recent-first
    expect((recent[0]!.params as any).n).toBe(4);
    expect((recent[1]!.params as any).n).toBe(3);
    expect((recent[2]!.params as any).n).toBe(2);

    const st = wd.stats();
    expect(st.totalIngested).toBe(5);
    expect(st.bufferSize).toBe(3);
    expect(st.capacity).toBe(3);
    expect(st.byDomain.Page).toBe(5);
  });

  test('subscribe by exact method', () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport);
    const got: string[] = [];
    wd.subscribe('Page.loadEventFired', (e) => { got.push(String((e.params as any).x)); });

    f.emit({ method: 'Page.loadEventFired', params: { x: 'a' } });
    f.emit({ method: 'Page.frameNavigated', params: { x: 'b' } });
    f.emit({ method: 'Page.loadEventFired', params: { x: 'c' } });

    expect(got).toEqual(['a', 'c']);
  });

  test('subscribe by wildcard Page.*', () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport);
    const got: string[] = [];
    wd.subscribe('Page.*', (e) => { got.push(e.method); });

    f.emit({ method: 'Page.loadEventFired', params: {} });
    f.emit({ method: 'Network.requestWillBeSent', params: {} });
    f.emit({ method: 'Page.frameNavigated', params: {} });

    expect(got).toEqual(['Page.loadEventFired', 'Page.frameNavigated']);
  });

  test('subscribe by * catches all', () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport);
    const got: string[] = [];
    wd.subscribe('*', (e) => { got.push(e.method); });

    f.emit({ method: 'Page.loadEventFired', params: {} });
    f.emit({ method: 'Network.requestWillBeSent', params: {} });
    expect(got).toEqual(['Page.loadEventFired', 'Network.requestWillBeSent']);
  });

  test('unsubscribe stops delivery', () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport);
    const got: string[] = [];
    const off = wd.subscribe('*', (e) => { got.push(e.method); });

    f.emit({ method: 'Page.loadEventFired', params: {} });
    off();
    f.emit({ method: 'Page.frameNavigated', params: {} });
    expect(got).toEqual(['Page.loadEventFired']);
  });

  test('enableDomain sends Domain.enable', async () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport);
    await wd.enableDomain('Page');
    await wd.enableDomain('Runtime');
    expect(f.sent.map(s => s.method)).toEqual(['Page.enable', 'Runtime.enable']);
  });

  test('listener that throws does not crash ingest', () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport);
    wd.subscribe('*', () => { throw new Error('boom'); });
    let ok = 0;
    wd.subscribe('*', () => { ok++; });
    f.emit({ method: 'Page.loadEventFired', params: {} });
    expect(ok).toBe(1);
    expect(wd.stats().totalIngested).toBe(1);
  });

  test('clear resets buffer + seq, keeps totals', () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport, { bufferSize: 5 });
    f.emit({ method: 'Page.loadEventFired', params: {} });
    f.emit({ method: 'Page.frameNavigated', params: {} });
    wd.clear();
    expect(wd.recent()).toEqual([]);
    expect(wd.stats().bufferSize).toBe(0);
    // Lifetime totals preserved
    expect(wd.stats().totalIngested).toBe(2);
    f.emit({ method: 'Page.loadEventFired', params: {} });
    expect(wd.recent()[0]!.seq).toBe(0); // seq reset
  });

  test('close detaches + stops delivery', () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport);
    let n = 0;
    wd.subscribe('*', () => { n++; });
    f.emit({ method: 'Page.loadEventFired', params: {} });
    wd.close();
    f.emit({ method: 'Page.loadEventFired', params: {} });
    expect(n).toBe(1);
  });

  test('recent(n) limits to n most-recent', () => {
    const f = fakeTransport();
    const wd = createWatchdog(f.transport, { bufferSize: 10 });
    for (let i = 0; i < 6; i++) {
      f.emit({ method: 'Page.loadEventFired', params: { i } });
    }
    const got = wd.recent(2);
    expect(got).toHaveLength(2);
    expect((got[0]!.params as any).i).toBe(5);
    expect((got[1]!.params as any).i).toBe(4);
  });
});
