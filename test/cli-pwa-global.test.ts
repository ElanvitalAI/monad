// P5 (2026-05-10) — pwa-global (status + clean) unit coverage.

import { describe, expect, test } from 'bun:test';

import {
  runPwaGlobalStatus,
  runPwaGlobalClean, defaultServeStatus } from '../src/cli/pwa-global.js';
import type { PwaInstanceListResult, PwaInstanceListing } from '../src/cli/pwa-registry.js';
import type { TailscaleProbe } from '../src/nexus/onboarding/tailscale-probe.js';

const TS_INSTALLED: TailscaleProbe = {
  installed: true,
  alive: true,
  binary: '/opt/homebrew/bin/tailscale',
  hostname: 'mbp',
  magicDnsHost: 'mbp.tail-abc.ts.net',
};

const tlsTcpMapping = (port: number) => ({
  TerminateTLS: 'mbp.tail-abc.ts.net',
  TCPForward: `localhost:${port}`,
});
const EMPTY_SERVE_STATUS = async () => ({ exitCode: 0, stdout: '{}', stderr: '' });
const serveStatus = (ports: number[]) => async () => ({
  exitCode: 0,
  stdout: JSON.stringify({ TCP: Object.fromEntries(ports.map((port) => [String(port), tlsTcpMapping(port)])) }),
  stderr: '',
});
const mixedServeStatus = async () => ({
  exitCode: 0,
  stdout: JSON.stringify({
    TCP: {
      '31416': tlsTcpMapping(31416),
      '31420': tlsTcpMapping(31420),
      '31421': { TCPForward: 'localhost:31421' },
    },
    Web: { 'mbp.tail-abc.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:31422' } } } },
  }),
  stderr: '',
});

function fixture(overrides: Partial<PwaInstanceListing> = {}): PwaInstanceListing {
  return {
    pid: 11111,
    ports: [31415],
    mode: 'static',
    kind: 'production',
    cwd: '/tmp/A',
    daemonDir: '/tmp/.monad/nexus',
    shareMounted: false,
    https: false,
    startedAt: '2026-05-10T12:00:00.000Z',
    alive: true,
    pidLiveness: 'alive',
    ...overrides,
  };
}

function inspected(instances: PwaInstanceListing[], diagnostics: Partial<PwaInstanceListResult['diagnostics']> = {}): PwaInstanceListResult {
  return {
    instances,
    diagnostics: {
      readState: instances.length ? 'present' : 'present-empty',
      livenessProbe: 'pid-signal-0',
      serviceObservation: 'unknown',
      serviceMismatch: false,
      registeredCount: instances.length,
      pruned: [],
      ...diagnostics,
    },
  };
}

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

describe('runPwaGlobalStatus', () => {
  test('empty registry → friendly hint', async () => {
    const out = makeOut();
    const r = await runPwaGlobalStatus({
      // ⛔ 리뷰 must-fix: 실제 tailscale 실행에 기대지 않는다 — 결정적 fake 를 «항상» 준다.
      probeFn: async () => TS_INSTALLED, serveStatusFn: serveStatus([]), out, listFn: () => inspected([]) });
    expect(r.exitCode).toBe(0);
    expect(r.instances).toEqual([]);
    expect(out.logs.some((l) => l.includes('No PWA daemons'))).toBe(true);
    expect(out.logs.some((l) => l.includes('monad nexus run --hmr'))).toBe(true);
  });

  test('empty inspected registry reports registry state, PID criterion, and no service conclusion', async () => {
    const out = makeOut();
    const r = await runPwaGlobalStatus({
      // ⛔ 리뷰 must-fix: 실제 tailscale 실행에 기대지 않는다 — 결정적 fake 를 «항상» 준다.
      probeFn: async () => TS_INSTALLED, serveStatusFn: serveStatus([]),
      out,
      listFn: () => inspected([], {
        readState: 'present-empty',
        serviceObservation: 'responding',
        serviceMismatch: true,
        pruned: [{ pid: 99999, reason: 'pid-not-alive' }],
      }),
    });
    expect(r.diagnostics).toMatchObject({ readState: 'present-empty', livenessProbe: 'pid-signal-0' });
    expect(out.logs.join('\n')).toContain('registry present-empty; this does not establish service absence');
    expect(out.logs.join('\n')).toContain('Registry liveness criterion: pid-signal-0; service observation: responding');
    expect(out.logs.join('\n')).toContain('Registry/service mismatch');
    expect(out.logs.join('\n')).toContain('pid 99999 (pid-not-alive)');
  });

  test('inspection diagnostics are included in JSON status output', async () => {
    const out = makeOut();
    await runPwaGlobalStatus({
      // ⛔ 리뷰 must-fix: 실제 tailscale 실행에 기대지 않는다 — 결정적 fake 를 «항상» 준다.
      probeFn: async () => TS_INSTALLED, serveStatusFn: serveStatus([]),
      out,
      format: 'json',
      listFn: () => inspected([], { readState: 'missing' }),
    });
    expect(JSON.parse(out.logs[0]!).diagnostics).toMatchObject({ readState: 'missing', serviceObservation: 'unknown', serviceMismatch: false });
  });

  test('reports exactly one disconnected TLS mount outside the registry', async () => {
    const out = makeOut();
    const r = await runPwaGlobalStatus({
      out,
      listFn: () => inspected([fixture({ ports: [31416] })]),
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: mixedServeStatus,
    });
    expect(r.orphanMountPorts).toEqual([31420]);
    expect(out.logs.join('\n')).toContain('Disconnected Tailscale mounts: 31420.');
    expect(out.logs.join('\n')).not.toContain('31421');
    expect(out.logs.join('\n')).not.toContain('31422');
  });

  test('reports zero disconnected TLS mounts explicitly', async () => {
    const out = makeOut();
    await runPwaGlobalStatus({
      out,
      listFn: () => inspected([fixture({ ports: [31416] })]),
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: serveStatus([31416]),
    });
    expect(out.logs.join('\n')).toContain('Disconnected Tailscale mounts: 0.');
  });

  test('treats an empty Serve status object as zero disconnected mounts', async () => {
    const out = makeOut();
    const r = await runPwaGlobalStatus({
      out,
      listFn: () => inspected([]),
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
    });
    expect(r.orphanMountPorts).toEqual([]);
    expect(r.orphanMountError).toBeUndefined();
    expect(out.logs.join('\n')).toContain('Disconnected Tailscale mounts: 0.');
    expect(out.logs.join('\n')).not.toContain('unavailable');
  });

  test('reports Serve status lookup failure rather than treating it as zero mounts', async () => {
    const out = makeOut();
    const r = await runPwaGlobalStatus({
      out,
      listFn: () => inspected([]),
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: async () => ({ exitCode: 1, stdout: '', stderr: 'permission denied' }),
    });
    expect(r.orphanMountError).toBe('permission denied');
    expect(out.logs.join('\n')).toContain('Disconnected Tailscale mounts: unavailable (permission denied).');
  });

  test('reports malformed Serve status as unavailable rather than zero mounts', async () => {
    const out = makeOut();
    const r = await runPwaGlobalStatus({
      out,
      listFn: () => inspected([]),
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: async () => ({ exitCode: 0, stdout: '{not json', stderr: '' }),
    });
    expect(r.orphanMountError).toBe('invalid Serve status JSON');
    expect(out.logs.join('\n')).toContain('Disconnected Tailscale mounts: unavailable (invalid Serve status JSON).');
  });

  test('reports malformed Serve TCP schema as unavailable rather than zero mounts', async () => {
    const out = makeOut();
    const r = await runPwaGlobalStatus({
      out,
      listFn: () => inspected([]),
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: async () => ({ exitCode: 0, stdout: JSON.stringify({ TCP: [] }), stderr: '' }),
    });
    expect(r.orphanMountError).toBe('invalid Serve status TCP schema');
    expect(out.logs.join('\n')).toContain('Disconnected Tailscale mounts: unavailable (invalid Serve status TCP schema).');
  });

  test('two instances → human format prints pid + ports + cwd', async () => {
    const out = makeOut();
    const r = await runPwaGlobalStatus({
      // ⛔ 리뷰 must-fix: 실제 tailscale 실행에 기대지 않는다 — 결정적 fake 를 «항상» 준다.
      probeFn: async () => TS_INSTALLED, serveStatusFn: serveStatus([]),
      out,
      listFn: () => inspected([
        fixture({ pid: 11111, ports: [31415], cwd: '/tmp/A' }),
        fixture({ pid: 22222, ports: [31420, 3211], mode: 'hmr', cwd: '/tmp/B', shareMounted: true }),
      ], { pruned: [{ pid: 99999, reason: 'pid-not-alive' }] }),
    });
    expect(r.exitCode).toBe(0);
    expect(r.instances).toHaveLength(2);
    expect(out.logs.some((l) => l.includes('pid 11111'))).toBe(true);
    expect(out.logs.some((l) => l.includes('pid 22222'))).toBe(true);
    expect(out.logs.some((l) => l.includes('[31420, 3211]'))).toBe(true);
    expect(out.logs.some((l) => l.includes('/tmp/A'))).toBe(true);
    expect(out.logs.some((l) => l.includes('share=on'))).toBe(true);
    expect(out.logs.some((l) => l.includes('Registry liveness criterion: pid-signal-0'))).toBe(true);
    expect(out.logs.some((l) => l.includes('This read pruned 1 entry(s): pid 99999 (pid-not-alive)'))).toBe(true);
    expect(r.diagnostics?.pruned).toEqual([{ pid: 99999, reason: 'pid-not-alive' }]);
  });

  test('stale entry shows ✗ tag', async () => {
    const out = makeOut();
    await runPwaGlobalStatus({
      // ⛔ 리뷰 must-fix: 실제 tailscale 실행에 기대지 않는다 — 결정적 fake 를 «항상» 준다.
      probeFn: async () => TS_INSTALLED, serveStatusFn: serveStatus([]),
      out,
      listFn: () => inspected([fixture({ pid: 99999, alive: false, pidLiveness: 'dead' })]),
    });
    expect(out.logs.some((l) => l.includes('✗ (stale)'))).toBe(true);
  });

  test('--json format → single JSON line', async () => {
    const out = makeOut();
    await runPwaGlobalStatus({
      // ⛔ 리뷰 must-fix: 실제 tailscale 실행에 기대지 않는다 — 결정적 fake 를 «항상» 준다.
      probeFn: async () => TS_INSTALLED, serveStatusFn: serveStatus([]),
      out,
      format: 'json',
      listFn: () => inspected([fixture({ pid: 11111 })]),
    });
    expect(out.logs).toHaveLength(1);
    const parsed = JSON.parse(out.logs[0]!);
    expect(parsed.instances).toHaveLength(1);
    expect(parsed.instances[0].pid).toBe(11111);
  });

  test('https=true entry shows share=ad-hoc tag', async () => {
    const out = makeOut();
    await runPwaGlobalStatus({
      // ⛔ 리뷰 must-fix: 실제 tailscale 실행에 기대지 않는다 — 결정적 fake 를 «항상» 준다.
      probeFn: async () => TS_INSTALLED, serveStatusFn: serveStatus([]),
      out,
      listFn: () => inspected([fixture({ shareMounted: true, https: true })]),
    });
    expect(out.logs.some((l) => l.includes('share=ad-hoc(--https)'))).toBe(true);
  });
});

describe('runPwaGlobalClean', () => {
  test('empty registry → no kills, no unmounts, friendly log', async () => {
    const out = makeOut();
    const r = await runPwaGlobalClean({
      out,
      listFn: () => [],
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
    });
    expect(r).toEqual({ exitCode: 0, killed: [], unmountedPorts: [], failedUnmountPorts: [], pruned: 0, cleared: false });
    expect(out.logs.some((l) => l.includes('No PWA daemons'))).toBe(true);
    expect(out.logs.join('\n')).toContain('Disconnected Tailscale mounts: 0.');
    expect(out.logs.join('\n')).not.toContain('unavailable');
  });

  test('happy path — 2 alive + 1 stale → SIGINT live, prune stale, clear registry', async () => {
    const out = makeOut();
    const killed: number[] = [];
    const unmounted: number[] = [];
    let cleared = false;
    let listCalls = 0;
    const r = await runPwaGlobalClean({
      out,
      listFn: () => { listCalls += 1; return [
        fixture({ pid: 11111, ports: [31415], shareMounted: true, alive: true }),
        fixture({ pid: 22222, ports: [31420, 3211], shareMounted: true, alive: true }),
        fixture({ pid: 99999, ports: [31425], shareMounted: true, alive: false }),
      ]; },
      killFn: (pid) => { killed.push(pid); },
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_b, port) => { unmounted.push(port); return { ok: true }; },
      clearFn: () => { cleared = true; },
    });
    expect(r.killed.sort()).toEqual([11111, 22222]);
    expect(r.unmountedPorts.sort((a, b) => a - b)).toEqual([3211, 31415, 31420, 31425]);
    expect(r.pruned).toBe(1);
    expect(r.cleared).toBe(true);
    expect(killed.sort()).toEqual([11111, 22222]);
    expect(unmounted.sort((a, b) => a - b)).toEqual([3211, 31415, 31420, 31425]);
    expect(cleared).toBe(true);
    expect(listCalls).toBe(1);
  });

  test('--dry-run → preview, no side effects', async () => {
    const out = makeOut();
    const killed: number[] = [];
    const unmounted: number[] = [];
    let cleared = false;
    const r = await runPwaGlobalClean({
      out,
      dryRun: true,
      listFn: () => [fixture({ pid: 11111, alive: true, shareMounted: true })],
      killFn: (pid) => { killed.push(pid); },
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_b, port) => { unmounted.push(port); return { ok: true }; },
      clearFn: () => { cleared = true; },
    });
    expect(r).toEqual({ exitCode: 0, killed: [], unmountedPorts: [], failedUnmountPorts: [], pruned: 0, cleared: false });
    expect(killed).toEqual([]);
    expect(unmounted).toEqual([]);
    expect(cleared).toBe(false);
    expect(out.logs.some((l) => l.includes('dry-run'))).toBe(true);
  });

  test('dry-run reports disconnected mounts without calling the ghost cleaner', async () => {
    const out = makeOut();
    await runPwaGlobalClean({
      out,
      dryRun: true,
      listFn: () => [fixture({ ports: [31416] })],
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: mixedServeStatus,
    });
    expect(out.logs.join('\n')).toContain('disconnected Tailscale mounts: 31420');
    expect(out.logs.join('\n')).not.toContain('31421');
  });


  // ⛔⭐ 리뷰 must-fix (2026-08-19) — 「미리보기는 아무것도 바꾸지 않는다」를 «직접» 건다.
  //   리뷰어 지적: 시험 stub 이 prune 을 무시하고 stale 을 돌려줘 실제 계약을 «가렸다».
  //   ⇒ stub 이 prune 을 «지키게» 만들어, 구현이 prune 을 켜면 stale 이 사라져 단언이 깨지게 한다.
  // 🔵 리뷰 should-fix: 기본 구현이 «무엇을 실행하는가»를 건다.
  //   주입된 serveStatusFn 만 검증하면 이 계약은 아무도 안 본다.
  test('defaultServeStatus runs `serve status --json` with the probed binary', async () => {
    const calls: Array<{ bin: string; args: string[] }> = [];
    const fakeExec = ((bin: string, args: string[], cb: (e: null, out: string, err: string) => void) => {
      calls.push({ bin, args });
      cb(null, '{"TCP":{}}', '');
      return undefined;
    }) as unknown as typeof import('node:child_process').execFile;
    const r = await defaultServeStatus('/opt/homebrew/bin/tailscale', fakeExec);
    expect(calls).toEqual([{ bin: '/opt/homebrew/bin/tailscale', args: ['serve', 'status', '--json'] }]);
    expect(r.exitCode).toBe(0);
  });

  // 🔵 리뷰 should-fix: status 뿐 아니라 clean 의 조회 실패 출력도 «직접» 건다.
  test('clean renders a serve-status lookup failure as unavailable', async () => {
    const out = makeOut();
    await runPwaGlobalClean({
      out,
      dryRun: true,
      listFn: () => [fixture({ ports: [31416], alive: true, shareMounted: true })],
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: async () => ({ exitCode: 1, stdout: '', stderr: 'serve status boom' }),
      killFn: () => {},
      clearFn: () => {},
    });
    expect(out.logs.join('\n')).toContain('disconnected Tailscale mounts: unavailable (serve status boom)');
  });

  // ⛔ 리뷰 must-fix: 등록 0 ⊕ 고아만 있는 경우가 clearFn 까지 흘러가 표를 비웠다.
  test('reports orphan mounts and clears nothing when the registry is empty', async () => {
    const out = makeOut();
    let cleared = false;
    const unmounted: number[] = [];
    const r = await runPwaGlobalClean({
      out,
      listFn: () => [],
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: serveStatus([31499]),
      unmountFn: async (_binary: string, port: number) => { unmounted.push(port); return { ok: true }; },
      killFn: () => {},
      clearFn: () => { cleared = true; },
    });
    expect(cleared).toBe(false);                 // ⛔ 표를 «안» 비운다
    expect(r.cleared).toBe(false);
    expect(unmounted).toEqual([]);
    expect(out.logs.join('\n')).toContain('Disconnected Tailscale mounts: 31499');
    expect(out.logs.join('\n')).not.toContain('registry cleared');
  });

  test('dry-run reads the registry without pruning and cleans nothing', async () => {
    const out = makeOut();
    const listOpts: Array<{ prune?: boolean }> = [];
    const unmounted: number[] = [];
    await runPwaGlobalClean({
      out,
      dryRun: true,
      // 실제 구현처럼 prune 을 «지킨다» — prune:true 면 낡은 항목을 안 돌려준다.
      listFn: (opts) => {
        listOpts.push(opts);
        const live = fixture({ ports: [31416], alive: true, shareMounted: true });
        const stale = fixture({ pid: 99999, ports: [31425], alive: false, shareMounted: true });
        return opts.prune ? [live] : [live, stale];
      },
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: serveStatus([31416, 31425, 31499]),
      // ⛔ 실제 계약은 (binary, port) 다 — 객체 구조분해 stub 은 «틀린 모양»이고
      //   dry-run 이라 안 불려 그 틀림이 «가려진다»(리뷰 must-fix · 2026-08-19).
      unmountFn: async (_binary: string, port: number) => { unmounted.push(port); return { ok: true }; },
      killFn: () => {},
      clearFn: () => {},
    });
    expect(listOpts).toEqual([{ prune: false }]);
    // 미리보기는 어떤 부작용도 내지 않는다.
    expect(unmounted).toEqual([]);
    // 그리고 낡은 항목이 «보인다» — prune 했다면 이 줄이 비었을 것이다.
    expect(out.logs.join('\n')).toContain('stale entries:    1');
  });

  // ⛔⭐ 리뷰 must-fix (2026-08-19): 이 시험은 종전에 `prune: true` 를 «단언»해 그 결함을 고정했다.
  //   ⓐ prune 은 «조회»가 상태를 바꾸는 것이라 --dry-run 계약을 깬다.
  //   ⓑ 그리고 애초에 «필요하지 않다» — findOrphanTailscaleMounts 가 이미 entry.alive 로 거른다.
  //   ⇒ 낡은 항목의 포트가 「소유 끊긴 마운트」로 잡히는 것은 prune 이 아니라 alive 필터의 결과다.
  test('treats a dead entry port as a disconnected mount without mutating the registry', async () => {
    const out = makeOut();
    const listOpts: Array<{ prune?: boolean }> = [];
    await runPwaGlobalClean({
      out,
      listFn: (opts) => {
        listOpts.push(opts);
        return [fixture({ ports: [31416], alive: true }), fixture({ pid: 99999, ports: [31420], alive: false, shareMounted: false })];
      },
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: serveStatus([31416, 31420]),
      killFn: () => {},
      clearFn: () => {},
    });
    expect(listOpts).toEqual([{ prune: false }]);   // 조회가 상태를 «안» 바꾼다
    // 이 착지는 «보고»까지다 — 걷지 않는다.
    expect(out.logs.join('\n')).toContain('disconnected Tailscale mounts: 31420');
  });


  test('--stale-only → keep alive, prune stale entries (registry not cleared)', async () => {
    const out = makeOut();
    const killed: number[] = [];
    const unmounted: number[] = [];
    let cleared = false;
    const removed: number[] = [];
    const r = await runPwaGlobalClean({
      out,
      staleOnly: true,
      listFn: () => [
        fixture({ pid: 11111, alive: true, shareMounted: true }),
        fixture({ pid: 99999, alive: false, shareMounted: true }),
      ],
      killFn: (pid) => { killed.push(pid); },
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_b, port) => { unmounted.push(port); return { ok: true }; },
      clearFn: () => { cleared = true; },
      unregisterFn: (pid) => { removed.push(pid); },
    });
    expect(r.killed).toEqual([]);
    expect(r.unmountedPorts).toEqual([31415]);
    expect(r.pruned).toBe(1);
    expect(r.cleared).toBe(false);
    expect(killed).toEqual([]);
    expect(unmounted).toEqual([31415]);
    expect(cleared).toBe(false);
    expect(removed).toEqual([99999]);
  });

  test('dead shared ports are unmounted before full cleanup clears the registry', async () => {
    const out = makeOut();
    const events: string[] = [];
    const r = await runPwaGlobalClean({
      out,
      listFn: () => [fixture({ pid: 99999, ports: [31425, 31415], shareMounted: true, alive: false })],
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_binary, port) => { events.push(`unmount:${port}`); return { ok: true }; },
      clearFn: () => { events.push('clear'); },
    });
    expect(r.unmountedPorts).toEqual([31425, 31415]);
    expect(events).toEqual(['unmount:31425', 'unmount:31415', 'clear']);
    expect(out.logs.join('\n')).toContain('stale share ports: 31425, 31415');
  });

  test('deduplicates shared ports and excludes dead entries that never mounted a share', async () => {
    const unmounted: number[] = [];
    const r = await runPwaGlobalClean({
      listFn: () => [
        fixture({ pid: 11111, ports: [31415, 31420], shareMounted: true, alive: true }),
        fixture({ pid: 99999, ports: [31420, 31425], shareMounted: true, alive: false }),
        fixture({ pid: 88888, ports: [3211], shareMounted: false, alive: false }),
      ],
      killFn: () => {},
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_binary, port) => { unmounted.push(port); return { ok: true }; },
      clearFn: () => {},
    });
    expect(r.unmountedPorts).toEqual([31415, 31420, 31425]);
    expect(unmounted).toEqual([31415, 31420, 31425]);
  });

  test('failed dead shared unmount is reported and retains its registry entry', async () => {
    const out = makeOut();
    const events: string[] = [];
    const r = await runPwaGlobalClean({
      out,
      listFn: () => [
        fixture({ pid: 99999, ports: [31425], shareMounted: true, alive: false }),
        fixture({ pid: 88888, ports: [31426], shareMounted: false, alive: false }),
      ],
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_binary, port) => { events.push(`unmount:${port}`); return { ok: false }; },
      clearFn: () => { events.push('clear'); },
      unregisterFn: (pid) => { events.push(`remove:${pid}`); },
    });
    expect(r.failedUnmountPorts).toEqual([31425]);
    expect(r.unmountedPorts).toEqual([]);
    expect(r.cleared).toBe(false);
    expect(r.pruned).toBe(1);
    expect(events).toEqual(['unmount:31425', 'remove:88888']);
    expect(out.logs.join('\n')).toContain('failed unmount ports: 31425');
  });

  test('stale-only retains a failed shared entry after attempting its unmount', async () => {
    const events: string[] = [];
    const r = await runPwaGlobalClean({
      staleOnly: true,
      listFn: () => [fixture({ pid: 99999, ports: [31425], shareMounted: true, alive: false })],
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_binary, port) => { events.push(`unmount:${port}`); return { ok: false }; },
      unregisterFn: (pid) => { events.push(`remove:${pid}`); },
    });
    expect(r.failedUnmountPorts).toEqual([31425]);
    expect(r.pruned).toBe(0);
    expect(events).toEqual(['unmount:31425']);
  });

  test('missing Tailscale reports ports and retains their registry entries', async () => {
    const removed: number[] = [];
    const r = await runPwaGlobalClean({
      listFn: () => [fixture({ pid: 99999, ports: [31425], shareMounted: true, alive: false })],
      probeFn: async () => ({ installed: false, alive: false }),
      unregisterFn: (pid) => { removed.push(pid); },
    });
    expect(r.failedUnmountPorts).toEqual([31425]);
    expect(r.cleared).toBe(false);
    expect(removed).toEqual([]);
  });

  test('dry-run previews stale shared ports without unmounting or pruning', async () => {
    const out = makeOut();
    const unmounted: number[] = [];
    let cleared = false;
    const r = await runPwaGlobalClean({
      out,
      dryRun: true,
      listFn: () => [fixture({ pid: 99999, ports: [31425], shareMounted: true, alive: false })],
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_binary, port) => { unmounted.push(port); return { ok: true }; },
      clearFn: () => { cleared = true; },
    });
    expect(r).toEqual({ exitCode: 0, killed: [], unmountedPorts: [], failedUnmountPorts: [], pruned: 0, cleared: false });
    expect(out.logs.join('\n')).toContain('stale share ports: 31425');
    expect(out.logs.join('\n')).toContain('ports to unmount: 31425');
    expect(unmounted).toEqual([]);
    expect(cleared).toBe(false);
  });

  test('shareMounted=false → no unmount call for that port', async () => {
    const out = makeOut();
    const unmounted: number[] = [];
    const r = await runPwaGlobalClean({
      out,
      listFn: () => [
        fixture({ pid: 11111, ports: [31415], shareMounted: false, alive: true }),
        fixture({ pid: 22222, ports: [31420], shareMounted: true, alive: true }),
      ],
      killFn: () => {},
      probeFn: async () => TS_INSTALLED,
      serveStatusFn: EMPTY_SERVE_STATUS,
      unmountFn: async (_b, port) => { unmounted.push(port); return { ok: true }; },
      clearFn: () => {},
    });
    expect(r.unmountedPorts).toEqual([31420]);
    expect(unmounted).toEqual([31420]);
  });

  test('tailscale not installed → kill still happens, unmount silently skipped', async () => {
    const out = makeOut();
    const killed: number[] = [];
    const unmounted: number[] = [];
    const r = await runPwaGlobalClean({
      out,
      listFn: () => [fixture({ pid: 11111, ports: [31415], shareMounted: true, alive: true })],
      killFn: (pid) => { killed.push(pid); },
      probeFn: async () => ({ installed: false, alive: false }),
      unmountFn: async (_b, port) => { unmounted.push(port); return { ok: true }; },
      clearFn: () => {},
    });
    expect(r.killed).toEqual([11111]);
    expect(r.unmountedPorts).toEqual([]);
    expect(unmounted).toEqual([]);
  });
});
