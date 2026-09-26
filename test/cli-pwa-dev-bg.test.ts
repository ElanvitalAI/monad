import { describe, expect, test } from 'bun:test';

import {
  runPwaDevBgLaunch,
  runPwaDevStatus,
  runPwaDevStop,
  type PwaDevLockMeta,
} from '../src/cli/pwa-dev-bg';

interface CapturedOut {
  log: (s: string) => void;
  error: (s: string) => void;
  logs: string[];
  errors: string[];
}

function makeOut(): CapturedOut {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    log: (s) => logs.push(s),
    error: (s) => errors.push(s),
    logs,
    errors,
  };
}

const aliveLock = (pid = 33445): PwaDevLockMeta => ({
  pid,
  host: 'mbp.local',
  startedAt: '2026-05-07T08:00:00Z',
  port: 3210,
  logPath: '/tmp/pwa-dev-test.log',
});

describe('runPwaDevBgLaunch', () => {
  test('aborts when an existing lock is alive', async () => {
    const out = makeOut();
    const r = await runPwaDevBgLaunch({
      argvBin: '/usr/local/bin/elanous',
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => true,
      spawnFn: () => ({ pid: 99999, unref: () => {} }),
      logPathFn: () => '/tmp/test.log',
      writeLockFn: () => {},
    });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('already running'))).toBe(true);
  });

  test('clears stale lock and launches fresh', async () => {
    const out = makeOut();
    let lockWritten: PwaDevLockMeta | null = null;
    const r = await runPwaDevBgLaunch({
      argvBin: '/usr/local/bin/elanous',
      port: 4321,
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => false, // stale
      spawnFn: (_cmd, _args, _opts) => ({ pid: 70001, unref: () => {} }),
      logPathFn: (stamp) => `/tmp/pwa-dev-${stamp}.log`,
      writeLockFn: (m) => {
        lockWritten = m;
      },
      now: () => 12345,
    });
    expect(r.exitCode).toBe(0);
    expect(r.pid).toBe(70001);
    expect(r.logPath).toBe('/tmp/pwa-dev-12345.log');
    expect(lockWritten).not.toBeNull();
    expect(lockWritten!.pid).toBe(70001);
    expect(lockWritten!.port).toBe(4321);
    expect(lockWritten!.logPath).toBe('/tmp/pwa-dev-12345.log');
    expect(out.logs.some((l) => l.includes('started in background'))).toBe(true);
  });

  test('passes --port to the foreground re-entry, NOT --bg (loop guard)', async () => {
    const out = makeOut();
    const spawnArgs: Array<{ args: string[] }> = [];
    await runPwaDevBgLaunch({
      argvBin: '/usr/local/bin/elanous',
      port: 5555,
      out,
      readLockFn: () => null,
      isAliveFn: () => false,
      spawnFn: (_cmd, args) => {
        spawnArgs.push({ args });
        return { pid: 1, unref: () => {} };
      },
      writeLockFn: () => {},
      logPathFn: () => '/tmp/x.log',
    });
    const args = spawnArgs[0].args;
    expect(args.slice(1)).toEqual(['nexus', 'pwa', 'dev', '--port', '5555']);
    expect(args).not.toContain('--bg');
  });

  test('forwards --host when passed (default omitted so child picks 0.0.0.0)', async () => {
    const out = makeOut();
    const spawnArgs: Array<{ args: string[] }> = [];
    await runPwaDevBgLaunch({
      argvBin: '/usr/local/bin/elanous',
      port: 3210,
      host: '127.0.0.1',
      out,
      readLockFn: () => null,
      isAliveFn: () => false,
      spawnFn: (_cmd, args) => {
        spawnArgs.push({ args });
        return { pid: 1, unref: () => {} };
      },
      writeLockFn: () => {},
      logPathFn: () => '/tmp/x.log',
    });
    expect(spawnArgs[0].args.slice(1)).toEqual([
      'nexus', 'pwa', 'dev', '--port', '3210', '--host', '127.0.0.1',
    ]);
  });

  test('errors out when spawn returns no pid', async () => {
    const out = makeOut();
    const r = await runPwaDevBgLaunch({
      argvBin: '/usr/local/bin/elanous',
      out,
      readLockFn: () => null,
      isAliveFn: () => false,
      spawnFn: () => ({ pid: undefined, unref: () => {} }),
      writeLockFn: () => {},
      logPathFn: () => '/tmp/x.log',
    });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('no pid'))).toBe(true);
  });

  test('errors out when argv[1] is empty', async () => {
    const out = makeOut();
    const r = await runPwaDevBgLaunch({ argvBin: '', out });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('argv[1]'))).toBe(true);
  });
});

describe('runPwaDevStatus', () => {
  test('reports not-running when no lock', () => {
    const out = makeOut();
    const r = runPwaDevStatus({
      out,
      readLockFn: () => null,
      isAliveFn: () => false,
    });
    expect(r.exitCode).toBe(1);
    expect(r.alive).toBe(false);
    expect(out.logs.some((l) => l.includes('not running'))).toBe(true);
  });

  test('reports stale-lock when pid is gone', () => {
    const out = makeOut();
    const r = runPwaDevStatus({
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => false,
    });
    expect(r.exitCode).toBe(1);
    expect(r.alive).toBe(false);
    expect(out.logs.some((l) => l.includes('stale lock'))).toBe(true);
  });

  test('reports running when alive', () => {
    const out = makeOut();
    const r = runPwaDevStatus({
      out,
      readLockFn: () => aliveLock(33445),
      isAliveFn: () => true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.alive).toBe(true);
    expect(r.meta?.pid).toBe(33445);
    expect(out.logs.some((l) => l.includes('running'))).toBe(true);
    expect(out.logs.some((l) => l.includes('33445'))).toBe(true);
  });
});

describe('runPwaDevStop', () => {
  test('no-op when no lock', async () => {
    const out = makeOut();
    const r = await runPwaDevStop({
      out,
      readLockFn: () => null,
      isAliveFn: () => false,
      killFn: () => {},
      removeLockFn: () => {},
      sleepFn: async () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(r.killed).toBe(false);
  });

  test('clears stale lock without kill (no orphans)', async () => {
    const out = makeOut();
    let removed = false;
    let killed = false;
    const r = await runPwaDevStop({
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => false,
      listGroupSurvivorsFn: () => [],
      killFn: () => {
        killed = true;
      },
      removeLockFn: () => {
        removed = true;
      },
      sleepFn: async () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(killed).toBe(false);
    expect(removed).toBe(true);
  });

  test('SIGTERM targets the WHOLE process group (negative pid)', async () => {
    const out = makeOut();
    const calls: Array<{ pid: number; sig: NodeJS.Signals }> = [];
    let removed = false;
    let leaderAlive = true;
    const r = await runPwaDevStop({
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => leaderAlive,
      listGroupSurvivorsFn: () => [],
      killFn: (pid, sig) => {
        calls.push({ pid, sig });
        leaderAlive = false;
      },
      removeLockFn: () => {
        removed = true;
      },
      sleepFn: async () => {},
      pollMs: 1,
      maxWaitMs: 100,
    });
    expect(r.exitCode).toBe(0);
    expect(r.killed).toBe(true);
    // Negative pid = process group target. Leader is 33445 → kill -33445.
    expect(calls).toEqual([{ pid: -33445, sig: 'SIGTERM' }]);
    expect(removed).toBe(true);
    expect(out.logs.some((l) => l.includes('process group reaped'))).toBe(true);
  });

  test('falls back to leader-only SIGTERM when group target throws', async () => {
    const out = makeOut();
    const calls: Array<{ pid: number; sig: NodeJS.Signals }> = [];
    let leaderAlive = true;
    const r = await runPwaDevStop({
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => leaderAlive,
      listGroupSurvivorsFn: () => [],
      killFn: (pid, sig) => {
        calls.push({ pid, sig });
        if (pid < 0) throw new Error('ESRCH'); // group dissolved
        leaderAlive = false;
      },
      removeLockFn: () => {},
      sleepFn: async () => {},
      pollMs: 1,
      maxWaitMs: 100,
    });
    expect(r.exitCode).toBe(0);
    expect(calls[0]).toEqual({ pid: -33445, sig: 'SIGTERM' });
    expect(calls[1]).toEqual({ pid: 33445, sig: 'SIGTERM' });
    expect(out.logs.some((l) => l.includes('group target failed'))).toBe(true);
  });

  test('escalates to SIGKILL when SIGTERM grace expires (descendants linger)', async () => {
    const out = makeOut();
    const calls: Array<{ pid: number; sig: NodeJS.Signals }> = [];
    // Real-world scenario: SIGTERM kills the leader but `bun run dev`
    // doesn't propagate to its `next dev` child. Leader exits, group
    // never empties, escalate.
    let leaderAlive = true;
    let phase: 'sigterm' | 'sigkill' = 'sigterm';
    const survivors = [9001, 9002]; // bun run dev + next dev
    const r = await runPwaDevStop({
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => leaderAlive,
      listGroupSurvivorsFn: () => (phase === 'sigkill' ? [] : survivors),
      killFn: (pid, sig) => {
        calls.push({ pid, sig });
        if (sig === 'SIGTERM' && pid === -33445) {
          // Leader dies, descendants don't.
          leaderAlive = false;
        }
        if (sig === 'SIGKILL') phase = 'sigkill';
      },
      removeLockFn: () => {},
      sleepFn: async () => {},
      pollMs: 1,
      maxWaitMs: 5,
      killGraceMs: 1,
    });
    expect(r.exitCode).toBe(0);
    expect(r.killed).toBe(true);
    expect(r.escalated).toEqual(survivors);
    // SIGTERM group → escalation diagnostic → SIGKILL group + per-survivor SIGKILL.
    expect(calls.some((c) => c.sig === 'SIGTERM' && c.pid === -33445)).toBe(true);
    expect(calls.some((c) => c.sig === 'SIGKILL' && c.pid === -33445)).toBe(true);
    expect(calls.some((c) => c.sig === 'SIGKILL' && c.pid === 9001)).toBe(true);
    expect(calls.some((c) => c.sig === 'SIGKILL' && c.pid === 9002)).toBe(true);
    expect(out.errors.some((e) => e.includes('escalating to SIGKILL'))).toBe(true);
    expect(out.errors.some((e) => e.includes('group survivors: 9001, 9002'))).toBe(true);
    expect(out.logs.some((l) => l.includes('after SIGKILL'))).toBe(true);
  });

  test('reaps pre-existing orphans on stale-lock cleanup', async () => {
    // Lock exists but leader is gone — descendants from a previous
    // botched stop are still around with PGID = stale leader pid.
    // Stop must SIGKILL them, not just clear the lock.
    const out = makeOut();
    const calls: Array<{ pid: number; sig: NodeJS.Signals }> = [];
    let removed = false;
    const r = await runPwaDevStop({
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => false,
      listGroupSurvivorsFn: () => [7001, 7002],
      killFn: (pid, sig) => calls.push({ pid, sig }),
      removeLockFn: () => { removed = true; },
      sleepFn: async () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(r.escalated).toEqual([7001, 7002]);
    expect(calls.some((c) => c.sig === 'SIGKILL' && c.pid === -33445)).toBe(true);
    expect(calls.some((c) => c.sig === 'SIGKILL' && c.pid === 7001)).toBe(true);
    expect(calls.some((c) => c.sig === 'SIGKILL' && c.pid === 7002)).toBe(true);
    expect(removed).toBe(true);
    expect(out.logs.some((l) => l.includes('2 orphan(s)'))).toBe(true);
  });

  test('gives up + reports survivors when SIGKILL itself fails to reap', async () => {
    const out = makeOut();
    const r = await runPwaDevStop({
      out,
      readLockFn: () => aliveLock(),
      isAliveFn: () => true, // leader stays alive through every signal
      listGroupSurvivorsFn: () => [9001],
      killFn: () => {}, // signals are no-ops (simulates uninterruptible sleep)
      removeLockFn: () => {},
      sleepFn: async () => {},
      pollMs: 1,
      maxWaitMs: 5,
      killGraceMs: 1,
    });
    expect(r.exitCode).toBe(1);
    expect(r.killed).toBe(false);
    expect(out.errors.some((e) => e.includes('giving up'))).toBe(true);
    expect(out.errors.some((e) => e.includes('survivors=9001'))).toBe(true);
  });
});
