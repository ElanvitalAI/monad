// H5 Phase 2 · TTY snapshot ring buffer tests.

import { describe, test, expect } from 'bun:test';
import {
  TtySnapshotStore,
  diffSnapshots,
  type TtySnapshot,
} from '../src/agent/tty-snapshot.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';

function makeSession(id: string, screen: string): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: 'test' },
    transports: [],
    state: () => ({ status: 'running' }),
    async send() {},
    async interrupt() {},
    async snapshot() { return screen; },
    async dispose() {},
  };
}

function record(store: TtySnapshotStore, sessionId: string, screen: string, at?: number): TtySnapshot {
  return store.record({
    sessionId,
    at: at ?? Date.now(),
    screen,
  });
}

describe('TtySnapshotStore · record + get + list', () => {
  test('record assigns id + bytes · retrievable by id', () => {
    const s = new TtySnapshotStore();
    const snap = record(s, 'sess-a', 'hello world');
    expect(snap.id).toMatch(/^snap-/);
    expect(snap.bytes).toBe(11);
    expect(s.get(snap.id)?.screen).toBe('hello world');
  });

  test('list returns snapshots for session in insertion order', () => {
    const s = new TtySnapshotStore();
    record(s, 'sess-a', 'a', 1);
    record(s, 'sess-a', 'b', 2);
    record(s, 'sess-a', 'c', 3);
    const out = s.list('sess-a');
    expect(out.map((x) => x.screen)).toEqual(['a', 'b', 'c']);
  });

  test('list empty session returns []', () => {
    const s = new TtySnapshotStore();
    expect(s.list('missing')).toEqual([]);
  });

  test('listNewestFirst sorts by at + honors limit', () => {
    const s = new TtySnapshotStore();
    record(s, 'sess-a', 'x', 10);
    record(s, 'sess-a', 'y', 30);
    record(s, 'sess-a', 'z', 20);
    const out = s.listNewestFirst('sess-a', 2);
    expect(out.map((x) => x.screen)).toEqual(['y', 'z']);
  });
});

describe('TtySnapshotStore · ring cap', () => {
  test('per-session cap evicts oldest when exceeded', () => {
    const s = new TtySnapshotStore({ maxPerSession: 3 });
    record(s, 'sess-a', 'a');
    record(s, 'sess-a', 'b');
    record(s, 'sess-a', 'c');
    record(s, 'sess-a', 'd');
    const remain = s.list('sess-a').map((x) => x.screen);
    expect(remain).toEqual(['b', 'c', 'd']);
    expect(s.stats().snapshots).toBe(3);
  });

  test('global budget evicts oldest across sessions', () => {
    const s = new TtySnapshotStore({ maxPerSession: 100, maxTotalBytes: 15 });
    record(s, 'sess-a', 'aaaaa', 1);  // 5B
    record(s, 'sess-b', 'bbbbb', 2);  // 10B total
    record(s, 'sess-a', 'ccccc', 3);  // 15B total
    record(s, 'sess-c', 'ddddd', 4);  // 20B → evicts oldest (aaaaa)
    expect(s.stats().bytes).toBeLessThanOrEqual(15);
    expect(s.get('snap-1')).toBeUndefined();
  });

  test('dropSession evicts all + returns count', () => {
    const s = new TtySnapshotStore();
    record(s, 'sess-a', 'a');
    record(s, 'sess-a', 'b');
    record(s, 'sess-b', 'c');
    expect(s.dropSession('sess-a')).toBe(2);
    expect(s.list('sess-a')).toEqual([]);
    expect(s.list('sess-b').length).toBe(1);
    expect(s.stats().snapshots).toBe(1);
  });

  test('clear resets everything', () => {
    const s = new TtySnapshotStore();
    record(s, 'sess-a', 'a');
    s.clear();
    expect(s.stats().snapshots).toBe(0);
    expect(s.stats().bytes).toBe(0);
  });
});

describe('TtySnapshotStore · capture from session', () => {
  test('captures session.snapshot() + label', async () => {
    const s = new TtySnapshotStore();
    const sess = makeSession('sess-cap', 'LIVE\noutput');
    const snap = await s.capture(sess, { label: 'before' });
    expect(snap.sessionId).toBe('sess-cap');
    expect(snap.screen).toBe('LIVE\noutput');
    expect(snap.label).toBe('before');
  });

  test('captures channels map + counts bytes', async () => {
    const s = new TtySnapshotStore();
    const sess = makeSession('sess-ch', 'screen');
    const snap = await s.capture(sess, {
      channels: { reasoning: 'think...', 'tool-call': 'exec ls' },
    });
    expect(snap.channels).toEqual({ reasoning: 'think...', 'tool-call': 'exec ls' });
    // bytes = screen (6) + channels (8 + 7 = 15) = 21
    expect(snap.bytes).toBe(21);
  });
});

describe('diffSnapshots', () => {
  test('added + removed + sameLines', () => {
    const a: TtySnapshot = {
      id: '1', sessionId: 's', at: 0, bytes: 0,
      screen: 'one\ntwo\nthree',
    };
    const b: TtySnapshot = {
      id: '2', sessionId: 's', at: 1, bytes: 0,
      screen: 'one\ntwo\nfour',
    };
    const d = diffSnapshots(a, b);
    expect(d.added).toEqual(['four']);
    expect(d.removed).toEqual(['three']);
    expect(d.sameLines).toBe(2);
  });
});
