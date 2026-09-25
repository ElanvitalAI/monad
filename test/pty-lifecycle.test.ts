// PtyShell lifecycle policy (2026-07-12). No time-based idle kill — an idle
// session survives indefinitely so it can be resumed after the user steps
// away. Accumulation is bounded ONLY when the concurrency cap is hit:
//   1. EXITED PTYs are reaped first (a finished command has no live context).
//   2. If still full, the oldest-UNTOUCHED live non-detached PTY is
//      LRU-evicted — recently-driven (resume-candidate) and detached
//      (explicitly persistent) PTYs are protected.

import { describe, test, expect, afterEach } from 'bun:test';
import { startPty, listPty, reapExited, resetForTesting, type PtyHandle } from '../src/pty-shell/registry';

afterEach(() => resetForTesting());
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

describe('cap policy — exited reap', () => {
  test('a spawn at the cap reclaims slots held by EXITED PTYs', async () => {
    for (let i = 0; i < 8; i++) startPty({ cmd: 'true', args: [] } as never); // exit immediately
    await sleep(300);
    expect(listPty().filter(h => h.isAlive()).length).toBe(0);
    // 9th spawn would exceed the cap — but the 8 dead ones get reaped first.
    const ninth = startPty({ cmd: 'sleep', args: ['5'] } as never);
    expect(ninth.isAlive()).toBe(true);
    expect(listPty().length).toBe(1);
    ninth.kill('SIGKILL');
  });

  test('reapExited() removes only dead handles', async () => {
    const alive = startPty({ cmd: 'sleep', args: ['5'] } as never);
    startPty({ cmd: 'true', args: [] } as never);
    await sleep(200);
    const reaped = reapExited();
    expect(reaped).toBe(1);
    expect(listPty().length).toBe(1);
    expect(alive.isAlive()).toBe(true);
    alive.kill('SIGKILL');
  });
});

describe('cap policy — resume-safe LRU eviction', () => {
  test('at cap with all live, the oldest-UNTOUCHED is evicted; recently-driven survives', async () => {
    const live: PtyHandle[] = [];
    for (let i = 0; i < 8; i++) { live.push(startPty({ cmd: 'sleep', args: ['30'] } as never)); await sleep(15); }
    // Drive one of the OLDER handles → its lastActivityAt moves to now, so it
    // must NOT be the eviction victim (simulates the user resuming it).
    live[1]!.drainDelta();
    startPty({ cmd: 'sleep', args: ['30'] } as never); // 9th → forces LRU eviction
    await sleep(100);
    expect(listPty().length).toBe(8);           // bounded, not errored
    expect(live[0]!.isAlive()).toBe(false);      // oldest untouched → evicted
    expect(live[1]!.isAlive()).toBe(true);       // recently driven → protected
    for (const h of live) { try { h.kill('SIGKILL'); } catch { /* */ } }
  });

  test('detached PTYs are never evicted (explicitly persistent)', async () => {
    const detached: PtyHandle[] = [];
    for (let i = 0; i < 8; i++) detached.push(startPty({ cmd: 'sleep', args: ['30'], detach: true } as never));
    await sleep(50);
    // All 8 are detached → no eviction candidate → spawn throws rather than
    // killing a detached session.
    expect(() => startPty({ cmd: 'sleep', args: ['30'] } as never)).toThrow(/max 8 concurrent/);
    expect(detached.every(h => h.isAlive())).toBe(true);
    for (const h of detached) { try { h.kill('SIGKILL'); } catch { /* */ } }
  });
});
