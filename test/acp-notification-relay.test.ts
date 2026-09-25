import { describe, expect, test } from 'bun:test';

import { NotificationStore } from '../src/notifications/store.js';
import { startNotificationRelay } from '../src/acp/notification-relay.js';
import type { AcpServerHandle, AcpRelayEvent, AcpRelayBlock } from '../src/acp/server.js';

interface FakeHandleCalls {
  notifies: Array<{ sessionId: string; evt: AcpRelayEvent }>;
  blocks: Array<{ sessionId: string; blk: AcpRelayBlock }>;
}

function makeFakeHandle(sessionIds: string[] = ['acp:1']): { handle: AcpServerHandle; calls: FakeHandleCalls } {
  const calls: FakeHandleCalls = { notifies: [], blocks: [] };
  const handle: AcpServerHandle = {
    async notify(sessionId, evt) { calls.notifies.push({ sessionId, evt }); },
    async block(sessionId, blk) { calls.blocks.push({ sessionId, blk }); },
    sessionIds() { return sessionIds.slice(); },
  };
  return { handle, calls };
}

describe('ACP notification relay (RC)', () => {
  test('default resolver forwards each push to the first bound session', () => {
    const store = new NotificationStore();
    const { handle, calls } = makeFakeHandle(['acp:1']);
    const off = startNotificationRelay({ store, handle });
    store.push({ sessionId: 'term:1', kind: 'status', title: 'working' });
    store.push({ sessionId: 'term:2', kind: 'block',  title: 'blk:3' });
    off();
    expect(calls.notifies.length).toBe(2);
    expect(calls.notifies[0]?.sessionId).toBe('acp:1');
    expect(calls.notifies[0]?.evt.kind).toBe('status');
    expect(calls.notifies[1]?.evt.kind).toBe('block');
  });

  test('skips relay when no ACP session is bound yet', () => {
    const store = new NotificationStore();
    const { handle, calls } = makeFakeHandle([]);
    startNotificationRelay({ store, handle });
    store.push({ sessionId: 'term:1', kind: 'status', title: 'working' });
    expect(calls.notifies.length).toBe(0);
  });

  test('resolveTargetSession: null return skips the relay', () => {
    const store = new NotificationStore();
    const { handle, calls } = makeFakeHandle(['acp:1']);
    startNotificationRelay({
      store, handle,
      resolveTargetSession: (e) => e.kind === 'status' ? null : 'acp:1',
    });
    store.push({ sessionId: 'term:1', kind: 'status', title: 'skip me' });
    store.push({ sessionId: 'term:1', kind: 'block',  title: 'keep me' });
    expect(calls.notifies.length).toBe(1);
    expect(calls.notifies[0]?.evt.title).toBe('keep me');
  });

  test('shouldRelay filter drops events before the resolver runs', () => {
    const store = new NotificationStore();
    const { handle, calls } = makeFakeHandle(['acp:1']);
    startNotificationRelay({
      store, handle,
      shouldRelay: (e) => e.kind !== 'osc',
    });
    store.push({ sessionId: 'term:1', kind: 'osc',    title: 'no relay' });
    store.push({ sessionId: 'term:1', kind: 'status', title: 'relay ok' });
    expect(calls.notifies.length).toBe(1);
    expect(calls.notifies[0]?.evt.title).toBe('relay ok');
  });

  test('unsubscribe stops further relays', () => {
    const store = new NotificationStore();
    const { handle, calls } = makeFakeHandle(['acp:1']);
    const off = startNotificationRelay({ store, handle });
    store.push({ sessionId: 'term:1', kind: 'status', title: 'a' });
    off();
    store.push({ sessionId: 'term:1', kind: 'status', title: 'b' });
    expect(calls.notifies.length).toBe(1);
  });

  test('relayed event body + meta round-trip through AcpRelayEvent', () => {
    const store = new NotificationStore();
    const { handle, calls } = makeFakeHandle(['acp:1']);
    startNotificationRelay({ store, handle });
    store.push({
      sessionId: 'term:1',
      kind: 'block',
      title: 'blk:3',
      body: 'first line',
      meta: { blockId: 'blk:3', kind: 'claude-code' },
    });
    expect(calls.notifies[0]?.evt.body).toBe('first line');
    expect(calls.notifies[0]?.evt.meta).toEqual({ blockId: 'blk:3', kind: 'claude-code' });
  });
});
