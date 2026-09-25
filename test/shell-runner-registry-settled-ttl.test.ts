// N3 — ShellRegistry settled-handle auto-hide.
//
// Completed/killed handles stay in the registry (for audit paths +
// includeSettled callers) but the default list() hides them once
// settledTtlMs has elapsed. Status-bar + /shell list + rollup popup
// all take the default path, so they don't clutter over time.

import { describe, expect, test } from 'bun:test';

import { createShellRegistry, DEFAULT_SETTLED_TTL_MS } from '../src/shell-runner/registry.js';
import type { ShellHandle, ShellStatus } from '../src/shell-runner/types.js';

function makeHandle(id: string): ShellHandle & { _setStatus: (s: ShellStatus) => void } {
  const statusSubs = new Set<(s: ShellStatus) => void>();
  let status: ShellStatus = 'running';
  return {
    id,
    mode: 'bg',
    get status() { return status; },
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
    _setStatus: (s) => {
      status = s;
      for (const cb of statusSubs) cb(s);
    },
  };
}

describe('N3 — settled handle TTL', () => {
  test('default list() hides handles whose settledAt is older than TTL', () => {
    let t = 1_000;
    const reg = createShellRegistry({ now: () => t });
    const h = makeHandle('h1');
    reg.register(h);
    h._setStatus('completed');         // settledAt = 1000
    // Just settled — still shown.
    expect(reg.list().map(x => x.id)).toEqual(['h1']);
    // Advance past TTL.
    t = 1_000 + DEFAULT_SETTLED_TTL_MS;
    expect(reg.list().map(x => x.id)).toEqual([]);
  });

  test('includeSettled:true bypasses the TTL filter', () => {
    let t = 2_000;
    const reg = createShellRegistry({ now: () => t });
    const h = makeHandle('h1');
    reg.register(h);
    h._setStatus('completed');
    t = 2_000 + DEFAULT_SETTLED_TTL_MS + 5_000;
    expect(reg.list({ includeSettled: true }).map(x => x.id)).toEqual(['h1']);
  });

  test('explicit status filter never hides (would always be empty otherwise)', () => {
    let t = 5_000;
    const reg = createShellRegistry({ now: () => t });
    const h = makeHandle('h1');
    reg.register(h);
    h._setStatus('killed');
    t = 5_000 + DEFAULT_SETTLED_TTL_MS + 10_000;
    // Without status filter default would hide; WITH status filter we
    // honour the caller's explicit intent.
    expect(reg.list({ status: 'killed' }).map(x => x.id)).toEqual(['h1']);
  });

  test('running + backgrounded handles are unaffected by the TTL', () => {
    let t = 10_000;
    const reg = createShellRegistry({ now: () => t });
    const running = makeHandle('alive');
    const bg = makeHandle('sleeping');
    reg.register(running);
    reg.register(bg);
    bg._setStatus('backgrounded');
    t = 10_000 + DEFAULT_SETTLED_TTL_MS * 10;
    expect(reg.list().map(x => x.id).sort()).toEqual(['alive', 'sleeping']);
  });

  test('custom settledTtlMs shortens the window', () => {
    let t = 0;
    const reg = createShellRegistry({ now: () => t, settledTtlMs: 500 });
    const h = makeHandle('h');
    reg.register(h);
    h._setStatus('completed');
    expect(reg.list().map(x => x.id)).toEqual(['h']);
    t = 499;
    expect(reg.list().length).toBe(1);
    t = 500;
    expect(reg.list().length).toBe(0);
  });

  test('settledAt is recorded per-transition — re-completing does not stack', () => {
    // Not a realistic path (handle lifecycle is monotonic), but verify
    // that the bookkeeping tolerates a late-arriving duplicate status
    // callback without accumulating.
    let t = 100;
    const reg = createShellRegistry({ now: () => t });
    const h = makeHandle('h');
    reg.register(h);
    h._setStatus('completed');
    t = 200;
    h._setStatus('completed');    // no-op in real life; still OK here
    t = 200 + DEFAULT_SETTLED_TTL_MS - 1;
    expect(reg.list().length).toBe(1);
    t = 200 + DEFAULT_SETTLED_TTL_MS;
    expect(reg.list().length).toBe(0);
  });
});
