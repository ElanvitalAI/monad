import { describe, expect, test } from 'bun:test';

import { NotificationStore } from '../src/notifications/store.js';

function makeStore(cap = 5): NotificationStore {
  let t = 1_000;
  return new NotificationStore({ capPerSession: cap, now: () => ++t });
}

describe('NotificationStore', () => {
  test('NT1 — push returns event with id + unread default', () => {
    const s = makeStore();
    const evt = s.push({ sessionId: 'term:1', kind: 'status', title: 'working' });
    expect(evt.id).toMatch(/^evt:\d+$/);
    expect(evt.read).toBe(false);
    expect(evt.ts).toBeGreaterThan(0);
  });

  test('NT1 — list returns events in push order, newest last', () => {
    const s = makeStore();
    s.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    s.push({ sessionId: 'term:1', kind: 'status', title: 'b' });
    s.push({ sessionId: 'term:2', kind: 'status', title: 'c' });
    expect(s.list('term:1').map(e => e.title)).toEqual(['a', 'b']);
    expect(s.list().map(e => e.title)).toEqual(['a', 'b', 'c']);
  });

  test('NT1 — cap drops oldest when exceeded', () => {
    const s = makeStore(2);
    s.push({ sessionId: 'term:1', kind: 'status', title: '1' });
    s.push({ sessionId: 'term:1', kind: 'status', title: '2' });
    s.push({ sessionId: 'term:1', kind: 'status', title: '3' });
    expect(s.list('term:1').map(e => e.title)).toEqual(['2', '3']);
  });

  test('NT1 — unreadCount / markRead flow', () => {
    const s = makeStore();
    s.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    s.push({ sessionId: 'term:1', kind: 'status', title: 'b' });
    s.push({ sessionId: 'term:2', kind: 'error', title: 'c' });
    expect(s.unreadCount('term:1')).toBe(2);
    expect(s.unreadCount('term:2')).toBe(1);
    expect(s.unreadCount()).toBe(3);
    expect(s.markRead('term:1')).toBe(2);
    expect(s.unreadCount('term:1')).toBe(0);
    expect(s.unreadCount()).toBe(1);
  });

  test('NT1 — markAllRead flips every session', () => {
    const s = makeStore();
    s.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    s.push({ sessionId: 'term:2', kind: 'block', title: 'b' });
    expect(s.markAllRead()).toBe(2);
    expect(s.unreadCount()).toBe(0);
  });

  test('NT1 — subscribe broadcasts every push in order', () => {
    const s = makeStore();
    const seen: string[] = [];
    const off = s.subscribe(e => seen.push(`${e.sessionId}:${e.title}`));
    s.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    s.push({ sessionId: 'term:2', kind: 'osc', title: 'b' });
    off();
    s.push({ sessionId: 'term:1', kind: 'status', title: 'c' });
    expect(seen).toEqual(['term:1:a', 'term:2:b']);
  });

  test('NT1 — sessions() lists every tracked session', () => {
    const s = makeStore();
    s.push({ sessionId: 'term:1', kind: 'status', title: 'x' });
    s.push({ sessionId: 'term:7', kind: 'status', title: 'y' });
    expect(new Set(s.sessions())).toEqual(new Set(['term:1', 'term:7']));
  });
});
