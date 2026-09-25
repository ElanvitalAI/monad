import { describe, expect, test } from 'bun:test';

import { runPwaStart } from '../src/cli/pwa-start.js';

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

describe('runPwaStart — stale Tailscale serve preflight', () => {
  test('healthProbe returns true → unmountServeFn NOT called (legitimate listener)', async () => {
    let unmountCalls = 0;
    await runPwaStart({
      mode: 'static',
      autoBuild: false,
      preflightStaleServe: true,
      verifyListen: true,
      bgLaunchFn: async () => ({ exitCode: 0, pid: 11 }),
      // probe sees the daemon alive on first try → preflight skips cleanup
      healthProbeFn: async () => true,
      unmountServeFn: async () => { unmountCalls += 1; return { ok: true }; },
      // listen-verify also passes — same probeFn surface defaults to fetch,
      // override fetch to keep verify happy too:
      fetchFn: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      readShareSwitchFn: () => 'disabled',
      shareProbeFn: async () => ({ installed: false, alive: false }),
      registerInstanceFn: () => { /* */ },
    });
    expect(unmountCalls).toBe(0);
  });

  test('healthProbe returns false → unmountServeFn called with the http port', async () => {
    let unmountedPort = -1;
    await runPwaStart({
      mode: 'static',
      autoBuild: false,
      preflightStaleServe: true,
      verifyListen: true,
      httpPort: 31499,
      bgLaunchFn: async () => ({ exitCode: 0, pid: 11 }),
      healthProbeFn: async () => false, // zombie state
      unmountServeFn: async (port) => { unmountedPort = port; return { ok: true }; },
      fetchFn: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      readShareSwitchFn: () => 'disabled',
      shareProbeFn: async () => ({ installed: false, alive: false }),
      registerInstanceFn: () => { /* */ },
    });
    expect(unmountedPort).toBe(31499);
  });

  test('verifyNexusListening fail → start returns non-zero with recovery hint', async () => {
    const out = makeOut();
    let calls = 0;
    const r = await runPwaStart({
      mode: 'static',
      autoBuild: false,
      preflightStaleServe: true,
      verifyListen: true,
      httpPort: 31499,
      out,
      bgLaunchFn: async () => ({ exitCode: 0, pid: 12 }),
      // preflight probe (1st call): false → stale cleanup attempted
      // verify probe (subsequent calls): never succeeds — daemon never bound
      healthProbeFn: async () => false,
      unmountServeFn: async () => ({ ok: false, reason: 'no-state' }),
      // fetch (used by verify probeUntilReady) always rejects to simulate
      // a dead listener:
      fetchFn: (async () => { calls += 1; throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch,
      sleepFn: () => Promise.resolve(),
      now: ((): (() => number) => {
        let t = 0;
        return () => {
          t += 200;
          return t;
        };
      })(),
    });
    expect(r.exitCode).toBe(1);
    expect(calls).toBeGreaterThan(0);
    expect(out.errors.some((e) => e.includes('nexus did not respond'))).toBe(true);
    expect(out.errors.some((e) => e.includes('tailscale serve reset'))).toBe(true);
    expect(out.errors.some((e) => e.includes('mcp.servers'))).toBe(true);
  });

  test('unmount returns sudo-required → preflight logs hint, start still proceeds', async () => {
    const out = makeOut();
    await runPwaStart({
      mode: 'static',
      autoBuild: false,
      preflightStaleServe: true,
      verifyListen: true,
      httpPort: 31415,
      out,
      bgLaunchFn: async () => ({ exitCode: 0, pid: 13 }),
      healthProbeFn: async () => false, // first probe → stale
      unmountServeFn: async () => ({ ok: false, reason: 'sudo-required', detail: 'sudo missing' }),
      // verify probe (subsequent calls): respond ok so we don't false-fail
      fetchFn: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      readShareSwitchFn: () => 'disabled',
      shareProbeFn: async () => ({ installed: false, alive: false }),
      registerInstanceFn: () => { /* */ },
    });
    expect(out.errors.some((e) => e.includes('sudo required to unmount'))).toBe(true);
    expect(out.errors.some((e) => e.includes('sudo tailscale serve reset'))).toBe(true);
  });
});
