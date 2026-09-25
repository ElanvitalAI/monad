import { describe, expect, test } from 'bun:test';

import { BlockStore } from '../src/block/store.js';
import { BlockAttachState } from '../src/block/attach.js';

function makeStore(): BlockStore {
  let t = 1_000;
  return new BlockStore({ capPerSession: 5, now: () => ++t });
}

describe('BlockAttachState', () => {
  test('BL4 — attach returns no-block when nothing has been captured', () => {
    const store = makeStore();
    const state = new BlockAttachState();
    const result = state.attach('term:1', store);
    expect(result.kind).toBe('no-block');
    expect(state.getPending()).toBeNull();
    expect(state.count()).toBe(0);
  });

  test('BL4 — attach pins the latest block + reports lines/bytes', () => {
    const store = makeStore();
    store.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'line 1\nline 2\nline 3' });
    const state = new BlockAttachState();
    const result = state.attach('term:1', store);
    expect(result.kind).toBe('attached');
    if (result.kind === 'attached') {
      expect(result.lines).toBe(3);
      expect(result.bytes).toBe(20);
      expect(result.total).toBe(1);
      expect(state.getPending()?.sessionId).toBe('term:1');
    }
  });

  test('BL-E1 — a newer attach appends instead of overwriting (multi-attach)', () => {
    const store = makeStore();
    store.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'first' });
    store.push('term:2', { kind: 'codex',       startedAt: 3, endedAt: 4, text: 'second' });
    const state = new BlockAttachState();
    state.attach('term:1', store);
    state.attach('term:2', store);
    expect(state.count()).toBe(2);
    const items = state.list();
    expect(items[0]?.sessionId).toBe('term:1');
    expect(items[1]?.sessionId).toBe('term:2');
    // Backward-compatible `getPending()` → newest
    expect(state.getPending()?.sessionId).toBe('term:2');
  });

  test('BL-E1 — queue cap drops the oldest attachment', () => {
    const store = makeStore();
    for (let i = 1; i <= 4; i++) {
      store.push(`term:${i}`, { kind: 'claude-code', startedAt: i, endedAt: i + 1, text: `text ${i}` });
    }
    const state = new BlockAttachState({ capAttachments: 2 });
    state.attach('term:1', store);
    state.attach('term:2', store);
    state.attach('term:3', store);
    expect(state.count()).toBe(2);
    expect(state.list()[0]?.sessionId).toBe('term:2');
    expect(state.list()[1]?.sessionId).toBe('term:3');
  });

  test('BL-E1 — clearSession drops only matching session', () => {
    const store = makeStore();
    store.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'a' });
    store.push('term:2', { kind: 'codex',       startedAt: 3, endedAt: 4, text: 'b' });
    const state = new BlockAttachState();
    state.attach('term:1', store);
    state.attach('term:2', store);
    state.attach('term:1', store); // latest of term:1 = same block
    const removed = state.clearSession('term:1');
    expect(removed).toBe(2);
    expect(state.count()).toBe(1);
    expect(state.getPending()?.sessionId).toBe('term:2');
  });

  test('BL5 — prependTo wraps user message with block prefix', () => {
    const store = makeStore();
    store.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'previous answer' });
    const state = new BlockAttachState();
    state.attach('term:1', store);
    const wrapped = state.prependTo('what was that again?');
    expect(wrapped).toContain('[Attached block');
    expect(wrapped).toContain('previous answer');
    expect(wrapped).toContain('what was that again?');
  });

  test('BL-E1 — prependTo stacks multiple blocks in queue order', () => {
    const store = makeStore();
    store.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'first answer' });
    store.push('term:2', { kind: 'codex',       startedAt: 3, endedAt: 4, text: 'second answer' });
    const state = new BlockAttachState();
    state.attach('term:1', store);
    state.attach('term:2', store);
    const wrapped = state.prependTo('combined?');
    const firstPos = wrapped.indexOf('first answer');
    const secondPos = wrapped.indexOf('second answer');
    const questionPos = wrapped.indexOf('combined?');
    expect(firstPos).toBeGreaterThanOrEqual(0);
    expect(secondPos).toBeGreaterThan(firstPos);
    expect(questionPos).toBeGreaterThan(secondPos);
  });

  test('BL5 — prependTo is a no-op when nothing is pending', () => {
    const state = new BlockAttachState();
    expect(state.prependTo('hi')).toBe('hi');
  });

  test('BL5 — consume wraps then clears', () => {
    const store = makeStore();
    store.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'x' });
    const state = new BlockAttachState();
    state.attach('term:1', store);
    const wrapped = state.consume('next');
    expect(wrapped).toContain('x');
    expect(state.getPending()).toBeNull();
    expect(state.count()).toBe(0);
  });

  test('BL5 — banner shows session + block id + size (single attach)', () => {
    const store = makeStore();
    store.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'two\nlines' });
    const state = new BlockAttachState();
    state.attach('term:1', store);
    const banner = state.banner();
    expect(banner).toContain('term:1');
    expect(banner).toContain('2L');
    expect(banner).toContain('Esc to detach');
  });

  test('BL-E1 — banner summarises multi-attach with session count + /attach-clear hint', () => {
    const store = makeStore();
    store.push('term:1', { kind: 'claude-code', startedAt: 1, endedAt: 2, text: 'a' });
    store.push('term:2', { kind: 'codex',       startedAt: 3, endedAt: 4, text: 'b' });
    const state = new BlockAttachState();
    state.attach('term:1', store);
    state.attach('term:2', store);
    const banner = state.banner();
    expect(banner).toContain('2 blocks');
    expect(banner).toContain('2 sessions');
    expect(banner).toContain('/attach-clear');
  });

  test('BL5 — banner null when detached', () => {
    const state = new BlockAttachState();
    expect(state.banner()).toBeNull();
    state.clear();
    expect(state.banner()).toBeNull();
  });
});
