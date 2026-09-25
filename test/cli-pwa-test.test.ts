// `monad nexus pwa test` orchestrator — unit tests.
//
// The orchestrator composes existing primitives (runPwaStart,
// runPwaStop, mountTailscaleServe). These tests inject those as
// seam fns so we don't actually spawn daemons or shell out.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { runPwaTest, type PwaTestOpts } from '../src/cli/pwa-test';
import type { PwaStartOpts } from '../src/cli/pwa-start';

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

let repoRoot: string;
let pwaOutDir: string;

beforeEach(() => {
  repoRoot = mkdtempSync(joinPath(tmpdir(), 'monad-pwa-test-'));
  // Synthesize the repo layout the orchestrator expects (bin/monad.mjs
  // + apps/pwa). The orchestrator's resolveRepoRoot sanity-checks
  // these so we have to materialize them.
  mkdirSync(joinPath(repoRoot, 'bin'), { recursive: true });
  writeFileSync(joinPath(repoRoot, 'bin', 'monad.mjs'), '#!/usr/bin/env bun\n');
  pwaOutDir = joinPath(repoRoot, 'apps', 'pwa', 'out');
  mkdirSync(pwaOutDir, { recursive: true });
  writeFileSync(joinPath(pwaOutDir, 'index.html'), '<html></html>');
});

afterEach(() => {
  try { rmSync(repoRoot, { recursive: true, force: true }); } catch { /* swallow */ }
  // Restore env we may have polluted.
  delete process.env.MONAD_NEXUS_DIR;
});

const baseSeams: Partial<PwaTestOpts> = {
  productionLockProbeFn: () => null,
  productionLockAliveFn: () => false,
  portInUseFn: () => false,
  pwaStartFn: async () => ({ exitCode: 0 }),
  pwaStopFn: async () => ({
    exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false,
    shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' },
  }),
  tailscaleMountFn: async () => ({
    ok: true, url: 'https://mbp.tailnet.ts.net:31415/app/showroom/',
  }),
  tailscaleUnmountFn: async () => ({
    ok: true,
    unmounted: { mode: { kind: 'tls-tcp', port: 31415 }, upstreamPort: 31415 },
  }),
  rebuildFn: async () => ({ exitCode: 0 }),
};

describe('runPwaTest — repo layout resolution', () => {
  test('errors when argv[1] does not point at a monad-agent checkout', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      argvBin: '/nowhere/monad',
      out,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('could not resolve repo root'))).toBe(true);
  });

  test('resolves repo root from argvBin via bin/monad.mjs sibling check', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      argvBin: joinPath(repoRoot, 'bin', 'monad.mjs'),
      out,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    expect(r.picked?.nexusPort).toBe(31415);
  });
});

describe('runPwaTest — tool cwd forwarding', () => {
  test('forwards an explicit tool cwd to pwa start', async () => {
    const out = makeOut();
    let received: PwaStartOpts | undefined;
    const r = await runPwaTest({
      repoRoot,
      out,
      ...baseSeams,
      toolCwd: '/tmp/isolated-tool-cwd',
      pwaStartFn: async (opts) => {
        received = opts;
        return { exitCode: 0 };
      },
    });

    expect(r.exitCode).toBe(0);
    expect(received!.toolCwd).toBe('/tmp/isolated-tool-cwd');
    expect(received!.httpHost).toBe('0.0.0.0');
    expect(received!.httpPort).toBe(31415);
  });
});

describe('runPwaTest — port collision auto-recovery', () => {
  test('default :31415 used when free + no production daemon', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    expect(r.picked?.nexusPort).toBe(31415);
  });

  test('falls back to :31420 when production daemon owns :31415', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
      productionLockProbeFn: () => ({
        pid: 12345,
        host: 'mbp.local',
        startedAt: new Date().toISOString(),
        nexusVersion: '0.17.0',
      } as ReturnType<NonNullable<PwaTestOpts['productionLockProbeFn']>>),
      productionLockAliveFn: () => true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.picked?.nexusPort).toBe(31420);
  });

  test('falls back beyond :31420 when both default + first fallback occupied externally', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
      portInUseFn: (p) => p === 31415 || p === 31420,
    });
    expect(r.exitCode).toBe(0);
    expect(r.picked?.nexusPort).toBe(31421);
  });

  test('errors when --port collides with an external occupant', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, port: 31420,
      ...baseSeams,
      portInUseFn: (p) => p === 31420,
    });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('31420'))).toBe(true);
  });

  test('honors explicit --port when free', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, port: 31999,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    expect(r.picked?.nexusPort).toBe(31999);
  });
});

describe('runPwaTest — HMR mode + dev port pick', () => {
  test('HMR allocates Next dev port (default 3210)', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, hmr: true,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    expect(r.picked?.devPort).toBe(3210);
  });

  test('HMR auto-picks next dev port on collision', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, hmr: true,
      ...baseSeams,
      portInUseFn: (p) => p === 3210 || p === 3211,
    });
    expect(r.exitCode).toBe(0);
    expect(r.picked?.devPort).toBe(3212);
  });

  test('HMR errors when no dev port is free', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, hmr: true,
      ...baseSeams,
      portInUseFn: (p) => p >= 3210 && p <= 3215,
    });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('Next dev port'))).toBe(true);
  });

  test('static mode does NOT allocate dev port', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
    });
    expect(r.picked?.devPort).toBeUndefined();
  });
});

describe('runPwaTest — Tailscale Serve --https opt-in', () => {
  test('default does not invoke Tailscale mount', async () => {
    let called = 0;
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
      tailscaleMountFn: async () => { called += 1; return { ok: true, url: null }; },
    });
    expect(r.exitCode).toBe(0);
    expect(r.tailscaleMounted).toBeFalsy();
    expect(called).toBe(0);
    // HTTP URL guide should be present.
    expect(out.logs.some((l) => l.includes('http://localhost:31415'))).toBe(true);
  });

  test('--https mounts Tailscale Serve + surfaces HTTPS URL', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, https: true,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    expect(r.tailscaleMounted).toBe(true);
    expect(r.url).toBe('https://mbp.tailnet.ts.net:31415/app/showroom/');
    expect(out.logs.some((l) => l.includes('iPad / external (HTTPS'))).toBe(true);
  });

  test('--voice is an alias for --https', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, voice: true,
      ...baseSeams,
    });
    expect(r.tailscaleMounted).toBe(true);
  });

  test('Tailscale mount failure surfaces error + falls back to HTTP guide', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, https: true,
      ...baseSeams,
      tailscaleMountFn: async () => ({
        ok: false, url: null, reason: 'sudo-required',
        detail: 'sudo prompt missed',
      }),
    });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('Tailscale Serve mount failed'))).toBe(true);
    expect(out.errors.some((e) => e.includes('sudo-required'))).toBe(true);
    expect(out.errors.some((e) => e.includes('http://localhost:31415'))).toBe(true);
  });
});

describe('runPwaTest — static mode auto-build', () => {
  test('runs rebuild when --rebuild is set', async () => {
    let rebuildCalls = 0;
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, rebuild: true,
      ...baseSeams,
      rebuildFn: async () => { rebuildCalls += 1; return { exitCode: 0 }; },
    });
    expect(r.exitCode).toBe(0);
    expect(rebuildCalls).toBe(1);
  });

  test('runs rebuild when apps/pwa/out is missing', async () => {
    rmSync(pwaOutDir, { recursive: true, force: true });
    let rebuildCalls = 0;
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
      rebuildFn: async () => {
        rebuildCalls += 1;
        // Recreate the dir so subsequent state writes succeed (the
        // orchestrator itself doesn't probe again, but parity with
        // production behavior keeps the test honest).
        mkdirSync(pwaOutDir, { recursive: true });
        return { exitCode: 0 };
      },
    });
    expect(r.exitCode).toBe(0);
    expect(rebuildCalls).toBe(1);
  });

  test('aborts when rebuild fails', async () => {
    rmSync(pwaOutDir, { recursive: true, force: true });
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
      rebuildFn: async () => ({ exitCode: 1 }),
    });
    expect(r.exitCode).toBe(1);
    expect(out.errors.some((e) => e.includes('pwa build failed'))).toBe(true);
  });

  test('HMR mode skips out-dir build (next dev compiles on demand)', async () => {
    rmSync(pwaOutDir, { recursive: true, force: true });
    let rebuildCalls = 0;
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, hmr: true,
      ...baseSeams,
      rebuildFn: async () => { rebuildCalls += 1; return { exitCode: 0 }; },
    });
    expect(r.exitCode).toBe(0);
    expect(rebuildCalls).toBe(0);
  });
});

describe('runPwaTest — canonical test-mode banner guidance', () => {
  test('advertises only nexus run --test commands for status and stop', async () => {
    const out = makeOut();

    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
    });

    const banner = out.logs.join('\n');
    expect(r.exitCode).toBe(0);
    expect(banner).toContain('stop      monad nexus run --test --stop');
    expect(banner).toContain('status    monad nexus run --test --status');
    expect(banner).not.toContain('monad nexus pwa test --stop');
    expect(banner).not.toContain('monad nexus pwa test --status');
  });
});

describe('runPwaTest — project-local state', () => {
  test('writes test-state.json under <repo>/.monad-test/', async () => {
    const out = makeOut();
    await runPwaTest({
      repoRoot, out,
      ...baseSeams,
    });
    const stateFile = joinPath(repoRoot, '.monad-test', 'test-state.json');
    expect(existsSync(stateFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(parsed.mode).toBe('static');
    expect(parsed.nexusPort).toBe(31415);
    expect(parsed.https).toBe(false);
  });

  test('sets test state root programmatically (no env var) · 2026-05-13 config-dir-unify', async () => {
    const out = makeOut();
    await runPwaTest({
      repoRoot, out,
      ...baseSeams,
    });
    const { getTestStateRoot, setTestStateRoot } = await import('../src/nexus/paths');
    expect(getTestStateRoot()).toBe(joinPath(repoRoot, '.monad-test'));
    // The env var that used to mirror this value is now untouched.
    expect(process.env.MONAD_NEXUS_DIR).toBeUndefined();
    setTestStateRoot(null);
  });
});

describe('runPwaTest --status', () => {
  test('reports no active instance when state file missing', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, status: true,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    expect(out.logs.some((l) => l.includes('no active test instance'))).toBe(true);
  });

  test('reads + prints active instance state', async () => {
    const stateDir = joinPath(repoRoot, '.monad-test');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      joinPath(stateDir, 'test-state.json'),
      JSON.stringify({
        mode: 'hmr',
        nexusPort: 31420,
        devPort: 3211,
        https: true,
        url: 'https://mbp.tailnet.ts.net:31420/app/showroom/',
        startedAt: '2026-05-09T22:00:00Z',
      }),
    );
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, status: true,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    expect(out.logs.some((l) => l.includes('hmr'))).toBe(true);
    expect(out.logs.some((l) => l.includes(':31420'))).toBe(true);
    expect(out.logs.some((l) => l.includes(':3211'))).toBe(true);
    expect(out.logs.some((l) => l.includes('mbp.tailnet.ts.net'))).toBe(true);
  });
});

describe('runPwaTest --stop', () => {
  test('cascades stop: Tailscale unmount + pwa stop', async () => {
    let stopCalls = 0;
    let unmountCalls = 0;
    const stateDir = joinPath(repoRoot, '.monad-test');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(joinPath(stateDir, 'test-state.json'), '{}');
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, stop: true,
      ...baseSeams,
      pwaStopFn: async () => {
        stopCalls += 1;
        return {
          exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false,
    shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' },
        };
      },
      tailscaleUnmountFn: async () => {
        unmountCalls += 1;
        return {
          ok: true,
          unmounted: { mode: { kind: 'tls-tcp', port: 31415 }, upstreamPort: 31415 },
        };
      },
    });
    expect(r.exitCode).toBe(0);
    expect(stopCalls).toBe(1);
    expect(unmountCalls).toBe(1);
    // Tailscale unmount before daemon stop (URL goes dark first).
    expect(out.logs.some((l) => l.includes('Tailscale Serve OFF'))).toBe(true);
  });

  test('stop succeeds when no Tailscale state is present (idempotent)', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, stop: true,
      ...baseSeams,
      tailscaleUnmountFn: async () => ({ ok: true, reason: 'no-state' }),
    });
    expect(r.exitCode).toBe(0);
  });
});

describe('FU8 PR #5 · --fresh prune + isolation flip', () => {
  test('--fresh prunes stale workflows/tasks/backups and preserves daemon state', async () => {
    const out = makeOut();
    // Pre-populate the state dir as a prior test run would leave it.
    const stateDir = joinPath(repoRoot, '.monad-test');
    mkdirSync(joinPath(stateDir, 'workflows'), { recursive: true });
    writeFileSync(joinPath(stateDir, 'workflows', 'greet-stale.yaml'), 'name: greet-stale\n');
    mkdirSync(joinPath(stateDir, 'tasks'), { recursive: true });
    writeFileSync(joinPath(stateDir, 'tasks', 'tasks.db'), 'stale db');
    mkdirSync(joinPath(stateDir, 'backups'), { recursive: true });
    writeFileSync(joinPath(stateDir, 'backups', 'tasks-old.db'), 'old');
    // Daemon-lifecycle files we must NOT prune.
    mkdirSync(joinPath(stateDir, 'logs'), { recursive: true });
    writeFileSync(joinPath(stateDir, 'logs', 'prior.log'), 'leave me alone');
    writeFileSync(joinPath(stateDir, 'runtime.json'), '{"prior":true}');

    const r = await runPwaTest({
      repoRoot, out, fresh: true,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    // Transient dirs gone.
    expect(existsSync(joinPath(stateDir, 'workflows'))).toBe(false);
    expect(existsSync(joinPath(stateDir, 'tasks'))).toBe(false);
    expect(existsSync(joinPath(stateDir, 'backups'))).toBe(false);
    // Daemon state preserved (logs + runtime.json predate this prune).
    expect(existsSync(joinPath(stateDir, 'logs', 'prior.log'))).toBe(true);
    expect(readFileSync(joinPath(stateDir, 'logs', 'prior.log'), 'utf8')).toBe('leave me alone');
    // The orchestrator wrote its own test-state.json — that's fine.
    // Banner mentions the prune.
    expect(out.logs.some((l) => l.includes('--fresh: pruned'))).toBe(true);
  });

  test('--fresh on a clean state dir reports "nothing to prune"', async () => {
    const out = makeOut();
    const r = await runPwaTest({
      repoRoot, out, fresh: true,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    expect(out.logs.some((l) => l.includes('--fresh: nothing to prune'))).toBe(true);
  });

  test('without --fresh, prior workflows survive (default behaviour preserved)', async () => {
    const out = makeOut();
    const stateDir = joinPath(repoRoot, '.monad-test');
    mkdirSync(joinPath(stateDir, 'workflows'), { recursive: true });
    writeFileSync(joinPath(stateDir, 'workflows', 'greet-stale.yaml'), 'name: greet-stale\n');
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    // Workflow file survives — pre-FU8 behaviour intact for users who
    // depend on cross-run workflow accretion.
    expect(existsSync(joinPath(stateDir, 'workflows', 'greet-stale.yaml'))).toBe(true);
  });

  test('--test DOES redirect the config dir to the test root (ISO-2 · 2026-07-13)', async () => {
    const out = makeOut();
    delete process.env.MONAD_DAEMON_DIR;
    const r = await runPwaTest({
      repoRoot, out,
      ...baseSeams,
    });
    expect(r.exitCode).toBe(0);
    // 2026-05-13 config-dir-unify 는 "--test 는 state 만 격리·config 공유+
    // overlay" 였으나, overlay 뷰 디스크 박제 오염 사건(#4029)과 미션 오발송
    // (2026-07-13) 후 대표 결정으로 **config 완전 격리**로 반전 — 테스트
    // 프로세스는 <repo>/.monad-test/config.json(물질화 사본)만 본다.
    const { getMonadConfigDir, resetMonadConfigDir } = await import('../src/monad-config-dir');
    expect(getMonadConfigDir()).toBe(joinPath(repoRoot, '.monad-test'));
    expect(process.env.MONAD_DAEMON_DIR).toBeUndefined();
    const { setTestStateRoot } = await import('../src/nexus/paths');
    setTestStateRoot(null);
    resetMonadConfigDir();
  });
});
