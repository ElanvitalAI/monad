import { describe, expect, test } from 'bun:test';

import { BlockStore } from '../src/block/store.js';

function makeStore(cap = 3): BlockStore {
  let t = 1_000;
  return new BlockStore({ capPerSession: cap, now: () => ++t });
}

describe('BlockStore', () => {
  test('BL1 — push / getLatest preserves order and returns the tail', () => {
    const s = makeStore();
    const a = s.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'one' });
    const b = s.push('term:1', { kind: 'claude-code', startedAt: 3, endedAt: 4, text: 'two' });
    expect(s.getLatest('term:1')?.id).toBe(b.id);
    expect(s.list('term:1').map(x => x.id)).toEqual([a.id, b.id]);
  });

  test('BL1 — cap drops the oldest entry when exceeded', () => {
    const s = makeStore(2);
    s.push('term:1', { kind: 'codex', startedAt: 1, endedAt: 2, text: 'a' });
    s.push('term:1', { kind: 'codex', startedAt: 3, endedAt: 4, text: 'b' });
    s.push('term:1', { kind: 'codex', startedAt: 5, endedAt: 6, text: 'c' });
    const list = s.list('term:1').map(b => b.text);
    expect(list).toEqual(['b', 'c']);
    expect(s.getLatest('term:1')?.text).toBe('c');
  });

  test('BL1 — list(limit) returns the N most recent entries', () => {
    const s = makeStore(10);
    for (let i = 0; i < 5; i++) {
      s.push('term:1', { kind: 'codex', startedAt: i, endedAt: i + 1, text: String(i) });
    }
    expect(s.list('term:1', 2).map(b => b.text)).toEqual(['3', '4']);
    expect(s.list('term:1', 10).map(b => b.text)).toEqual(['0', '1', '2', '3', '4']);
  });

  test('BL1 — clear / clearAll drop sessions without touching siblings', () => {
    const s = makeStore();
    s.push('term:1', { kind: 'codex', startedAt: 1, endedAt: 2, text: 'a' });
    s.push('term:2', { kind: 'codex', startedAt: 3, endedAt: 4, text: 'b' });
    s.clear('term:1');
    expect(s.getLatest('term:1')).toBeUndefined();
    expect(s.getLatest('term:2')?.text).toBe('b');
    s.clearAll();
    expect(s.entries()).toEqual([]);
  });

  test('BL1 — subscribe broadcasts every commit in push order', () => {
    const s = makeStore();
    const seen: string[] = [];
    const off = s.subscribe(b => seen.push(`${b.sessionId}:${b.text}`));
    s.push('term:1', { kind: 'codex', startedAt: 1, endedAt: 2, text: 'a' });
    s.push('term:2', { kind: 'codex', startedAt: 3, endedAt: 4, text: 'b' });
    off();
    s.push('term:1', { kind: 'codex', startedAt: 5, endedAt: 6, text: 'c' });
    expect(seen).toEqual(['term:1:a', 'term:2:b']);
  });

  test('BL1 — nextId produces stable per-store ids', () => {
    const s = makeStore();
    const a = s.nextId();
    const b = s.nextId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^blk:\d+$/);
  });

  test('BL-E3 — pin protects a block from ring rotation', () => {
    const s = makeStore(2);
    const a = s.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'keep-me' });
    s.push('term:1', { kind: 'claude-code', startedAt: 3, endedAt: 4, text: 'b' });
    expect(s.pin('term:1', a.id)).toBe(true);
    s.push('term:1', { kind: 'claude-code', startedAt: 5, endedAt: 6, text: 'c' });
    // cap=2, but pinned 'keep-me' survives; non-pinned 'b' evicted.
    const texts = s.list('term:1').map(b => b.text);
    expect(texts).toContain('keep-me');
    expect(texts).not.toContain('b');
    expect(texts).toContain('c');
  });

  test('BL-E3 — unpin restores rotation eligibility', () => {
    const s = makeStore(2);
    const a = s.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'a' });
    s.pin('term:1', a.id);
    s.push('term:1', { kind: 'claude-code', startedAt: 3, endedAt: 4, text: 'b' });
    s.push('term:1', { kind: 'claude-code', startedAt: 5, endedAt: 6, text: 'c' });
    // pinned 'a' survives while unpinned.
    expect(s.list('term:1').map(b => b.text)).toContain('a');
    expect(s.unpin('term:1', a.id)).toBe(true);
    s.push('term:1', { kind: 'claude-code', startedAt: 7, endedAt: 8, text: 'd' });
    // 'a' now evicted.
    expect(s.list('term:1').map(b => b.text)).not.toContain('a');
  });

  test('BL-E3 — pinned() returns only bookmarked blocks', () => {
    const s = makeStore(5);
    const a = s.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'a' });
    const b = s.push('term:1', { kind: 'claude-code', startedAt: 3, endedAt: 4, text: 'b' });
    s.push('term:1', { kind: 'claude-code', startedAt: 5, endedAt: 6, text: 'c' });
    s.pin('term:1', a.id);
    s.pin('term:1', b.id);
    expect(s.pinned('term:1').map(x => x.text)).toEqual(['a', 'b']);
  });

  test('BL-E3 — pin/unpin on missing id returns false (no throw)', () => {
    const s = makeStore();
    expect(s.pin('term:1', 'blk:999')).toBe(false);
    expect(s.unpin('term:1', 'blk:999')).toBe(false);
    s.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'a' });
    expect(s.pin('term:1', 'blk:nope')).toBe(false);
  });
});
