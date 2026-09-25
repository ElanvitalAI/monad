// SP-B — ShellRegistry onRegister/onUnregister observer hooks.
//
// Covers the handle-lifecycle fan-out that the dashboard uses to
// wire BackgroundSurface mirrors. onRegister fires once per register,
// AFTER the policy timers arm. onUnregister fires on explicit drop.

import { describe, expect, test } from 'bun:test';

import { createShellRegistry } from '../src/shell-runner/registry.js';
import type { ShellHandle, ShellStatus } from '../src/shell-runner/types.js';

function makeHandle(id: string, mode: ShellHandle['mode'] = 'bg'): ShellHandle {
  const statusSubs = new Set<(s: ShellStatus) => void>();
  return {
    id,
    mode,
    status: 'running',
    bookmark: { row: 0, col: 0, ts: 0, bytes: 0 },
    kill() { /* noop */ },
    background() { return true; },
    promote() { return true; },
    write() { /* noop */ },
    resize() { /* noop */ },
    onChunk() { return () => {}; },
    onBoundary() { return () => {}; },
    onStatus(cb) { statusSubs.add(cb); return () => { statusSubs.delete(cb); }; },
    result: new Promise(() => {}),
  };
}

describe('SP-B — ShellRegistry observer hooks', () => {
  test('onRegister fires once per register', () => {
    const ids: string[] = [];
    const reg = createShellRegistry({ onRegister: (h) => ids.push(h.id) });
    reg.register(makeHandle('a'));
    reg.register(makeHandle('b'));
    // Dup register: already in map → no-op, onRegister should NOT fire.
    reg.register({ ...makeHandle('a') } as ShellHandle);
    expect(ids).toEqual(['a', 'b']);
  });

  test('onUnregister fires on explicit drop', () => {
    const removed: string[] = [];
    const reg = createShellRegistry({ onUnregister: (id) => removed.push(id) });
    reg.register(makeHandle('a'));
    reg.unregister('a');
    reg.unregister('a'); // unknown id → no-op
    expect(removed).toEqual(['a']);
  });

  test('hooks throwing are isolated — register/unregister still complete', () => {
    const reg = createShellRegistry({
      onRegister: () => { throw new Error('boom'); },
      onUnregister: () => { throw new Error('boom'); },
    });
    reg.register(makeHandle('a'));
    expect(reg.size()).toBe(1);
    reg.unregister('a');
    expect(reg.size()).toBe(0);
  });
});
