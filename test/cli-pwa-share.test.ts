// P.4 — `elanous nexus pwa share enable|disable|status` CLI unit coverage.

import { describe, expect, test } from 'bun:test';

import {
  pwaShareEnable,
  pwaShareDisable,
  pwaShareStatus,
  type PwaShareDeps,
  type ShareTailnetValue,
} from '../src/cli/pwa-share.js';
import { inspectTailscaleServeMount, type TailscaleServeMountStatus } from '../src/cli/tailscale-serve.js';
import type { TailscaleProbe } from '../src/nexus/onboarding/tailscale-probe.js';
import type { NexusPwaResolution } from '../src/cli/nexus-show.js';

interface SharedState {
  switchValue: ShareTailnetValue;
  probe: TailscaleProbe;
  serveExitCode: number;
  resetExitCode: number;
  mountStatus: TailscaleServeMountStatus;
  saveCalls: ShareTailnetValue[];
  serveCalls: number;
  resetCalls: number;
  logs: string[];
  errors: string[];
}

function mkDeps(state: Partial<SharedState> = {}): { deps: PwaShareDeps; state: SharedState } {
  const s: SharedState = {
    switchValue: 'ask',
    probe: {
      installed: true,
      alive: true,
      hostname: 'mbp',
      magicDnsHost: 'mbp.tail-abc.ts.net',
      ips: ['100.64.0.2'],
      binary: '/opt/homebrew/bin/tailscale',
    },
    serveExitCode: 0,
    resetExitCode: 0,
    mountStatus: 'mounted',
    saveCalls: [],
    serveCalls: 0,
    resetCalls: 0,
    logs: [],
    errors: [],
    ...state,
  };
  const deps: PwaShareDeps = {
    readSwitch: () => s.switchValue,
    saveSwitch: (v) => { s.saveCalls.push(v); s.switchValue = v; },
    probeFn: async () => s.probe,
    serveFn: async () => { s.serveCalls += 1; return { exitCode: s.serveExitCode }; },
    resetFn: async () => { s.resetCalls += 1; return { exitCode: s.resetExitCode }; },
    nexusAliveFn: async () => true,
    mountStatusFn: async () => s.mountStatus,
    port: 31415,
    out: {
      log: (l) => s.logs.push(l),
      error: (l) => s.errors.push(l),
    },
  };
  return { deps, state: s };
}

describe('inspectTailscaleServeMount', () => {
  const inspect = (exitCode: number, stdout: string) => inspectTailscaleServeMount({
    port: 31415,
    serveCmdFn: async () => ({ exitCode, stdout, stderr: 'status failed' }),
  });

  test('directly classifies TLS localhost mapping, mismatches, absent mappings, and unreadable status', async () => {
    expect(await inspect(0, JSON.stringify({
      TCP: { '31415': { TerminateTLS: 'example.ts.net', TCPForward: 'tcp://localhost:31415' } },
    }))).toBe('mounted');
    expect(await inspect(0, JSON.stringify({
      TCP: { '31415': { TerminateTLS: 'example.ts.net', TCPForward: 'tcp://localhost:9999' } },
    }))).toBe('unmounted');
    expect(await inspect(0, JSON.stringify({
      TCP: { '31415': { TCPForward: 'tcp://localhost:31415' } },
    }))).toBe('unmounted');
    expect(await inspect(0, JSON.stringify({ TCP: {} }))).toBe('unmounted');
    expect(await inspect(1, '')).toBe('unknown');
    expect(await inspect(0, '{not json')).toBe('unknown');
  });

  // ⛔ 2026-08-14 실측 회귀 — 위 픽스처는 전부 `tcp://` 접두를 가진 «추정» 형태다.
  //   진짜 `tailscale serve status --json` 은 스킴 없이 준다. 그 형태를 mounted 로 못 읽어
  //   동작하는 tailnet 주소를 감췄다. 아래가 그 실물이다.
  test('classifies the real scheme-less TCPForward that tailscale actually emits', async () => {
    expect(await inspect(0, JSON.stringify({
      TCP: { '31415': { TerminateTLS: 'mbp.tailnet-example.ts.net', TCPForward: 'localhost:31415' } },
    }))).toBe('mounted');
    // 포트가 다르면 스킴이 없어도 여전히 unmounted 다.
    expect(await inspect(0, JSON.stringify({
      TCP: { '31415': { TerminateTLS: 'mbp.tailnet-example.ts.net', TCPForward: 'localhost:9999' } },
    }))).toBe('unmounted');
  });
});

describe('P.4 · pwaShareEnable', () => {
  test('Tailscale alive + serve OK → switch enabled + URL log', async () => {
    const { deps, state } = mkDeps();
    const result = await pwaShareEnable(deps);
    expect(result.exitCode).toBe(0);
    expect(state.serveCalls).toBe(1);
    expect(state.saveCalls).toEqual(['enabled']);
    // P1 unification (2026-05-10): tls-tcp mode → URL carries `:31415`
    // (HTTP/1.1 forwarder · WebSocket Upgrade 101). Previously the
    // `--https=443` mode produced port-less URLs but stripped WS.
    expect(state.logs.some((l) => l.includes('https://mbp.tail-abc.ts.net:31415/app/'))).toBe(true);
    expect(result.report?.urls.tailnet).toBe('https://mbp.tail-abc.ts.net:31415/app/');
  });

  test('nexus down → enable still succeeds, banner appends `nexus run` hint', async () => {
    const { deps, state } = mkDeps();
    const result = await pwaShareEnable({ ...deps, nexusAliveFn: async () => false });
    expect(result.exitCode).toBe(0);
    expect(state.saveCalls).toEqual(['enabled']);
    expect(state.logs.some((l) => l.includes('nexus is not currently running') && l.includes('elanous nexus run'))).toBe(true);
  });

  test('Tailscale not installed → exit 1, switch unchanged', async () => {
    const { deps, state } = mkDeps({
      probe: { installed: false, alive: false },
    });
    const result = await pwaShareEnable(deps);
    expect(result.exitCode).toBe(1);
    expect(state.saveCalls).toEqual([]);
    expect(state.errors.some((e) => e.includes('not installed'))).toBe(true);
  });

  test('Tailscale installed but Stopped → exit 1, switch unchanged', async () => {
    const { deps, state } = mkDeps({
      probe: { installed: true, alive: false, backendState: 'Stopped' },
    });
    const result = await pwaShareEnable(deps);
    expect(result.exitCode).toBe(1);
    expect(state.saveCalls).toEqual([]);
    expect(state.errors.some((e) => e.includes('not active'))).toBe(true);
  });

  test('serve fails → exit propagates, but switch IS saved (intent-first persistence)', async () => {
    const { deps, state } = mkDeps({ serveExitCode: 2 });
    const result = await pwaShareEnable(deps);
    expect(result.exitCode).toBe(2);
    // Switch saved before serve attempt — user's intent persists across
    // transient serve failures. Next `pwa start` retries automatically.
    expect(state.saveCalls).toEqual(['enabled']);
    expect(state.errors.some((e) => e.includes('Switch saved') && e.includes('next `pwa start`'))).toBe(true);
  });

  test('omitted port reports the 31415 fallback as default, while an injected port remains explicit', async () => {
    const { deps } = mkDeps();
    const defaultResult = await pwaShareEnable({ ...deps, port: undefined });
    expect(defaultResult.report).toMatchObject({ port: 31415, portSource: 'default' });

    const explicitResult = await pwaShareEnable({ ...deps, port: 31416 });
    expect(explicitResult.report).toMatchObject({ port: 31416, portSource: 'explicit' });
  });
});

describe('P.4 · pwaShareDisable', () => {
  test('alive Tailscale → reset called + switch disabled', async () => {
    const { deps, state } = mkDeps({ switchValue: 'enabled' });
    const result = await pwaShareDisable(deps);
    expect(result.exitCode).toBe(0);
    expect(state.resetCalls).toBe(1);
    expect(state.saveCalls).toEqual(['disabled']);
  });

  test('Tailscale not alive → reset skipped, switch still flipped', async () => {
    const { deps, state } = mkDeps({
      switchValue: 'enabled',
      probe: { installed: false, alive: false },
    });
    const result = await pwaShareDisable(deps);
    expect(result.exitCode).toBe(0);
    expect(state.resetCalls).toBe(0);
    expect(state.saveCalls).toEqual(['disabled']);
  });

  test('reset exit !=0 → warn + still flip switch (idempotent)', async () => {
    const { deps, state } = mkDeps({ switchValue: 'enabled', resetExitCode: 1 });
    const result = await pwaShareDisable(deps);
    expect(result.exitCode).toBe(0);
    expect(state.saveCalls).toEqual(['disabled']);
    // P1 unification (2026-05-10): per-port unmount replaces global
    // `serve reset` — warn message now reads "unmount exit N".
    expect(state.errors.some((e) => e.includes('unmount exit 1'))).toBe(true);
  });

  test('omitted port reports the 31415 fallback as default, while an injected port remains explicit', async () => {
    const { deps } = mkDeps({ switchValue: 'enabled' });
    const defaultResult = await pwaShareDisable({ ...deps, port: undefined });
    expect(defaultResult.report).toMatchObject({ port: 31415, portSource: 'default' });

    const explicitResult = await pwaShareDisable({ ...deps, port: 31416 });
    expect(explicitResult.report).toMatchObject({ port: 31416, portSource: 'explicit' });
  });
});

describe('P.4 · pwaShareStatus', () => {
  test('human format → multi-line readable report', async () => {
    const { deps, state } = mkDeps({ switchValue: 'enabled' });
    const result = await pwaShareStatus(deps, 'human');
    expect(result.exitCode).toBe(0);
    expect(state.logs.some((l) => l.includes('switch       enabled'))).toBe(true);
    expect(state.logs.some((l) => l.includes('tailscale    installed=true alive=true'))).toBe(true);
    expect(state.logs.some((l) => l.includes('mount        mounted'))).toBe(true);
    expect(state.logs.some((l) => l.includes('local URL    http://127.0.0.1:31415/app/'))).toBe(true);
    expect(state.logs.some((l) => l.includes('tailnet URL  https://mbp.tail-abc.ts.net:31415/app/'))).toBe(true);
  });

  test('json format → single JSON.stringified line', async () => {
    const { deps, state } = mkDeps({ switchValue: 'disabled' });
    const result = await pwaShareStatus(deps, 'json');
    expect(result.exitCode).toBe(0);
    expect(state.logs).toHaveLength(1);
    const parsed = JSON.parse(state.logs[0]!);
    expect(parsed.switchValue).toBe('disabled');
    expect(parsed.tailscale.installed).toBe(true);
    expect(parsed.urls.tailnet).toBeUndefined();   // disabled → no tailnet URL
  });

  test('switch=disabled → no tailnet URL even when Tailscale alive', async () => {
    const { deps } = mkDeps({ switchValue: 'disabled' });
    const result = await pwaShareStatus(deps, 'json');
    expect(result.report?.urls.tailnet).toBeUndefined();
    expect(result.report?.urls.local).toBe('http://127.0.0.1:31415/app/');
  });

  test('mount seam distinguishes mounted, unmounted, and unknown without changing prior probe fields', async () => {
    for (const mountStatus of ['mounted', 'unmounted', 'unknown'] as const) {
      const { deps, state } = mkDeps({ switchValue: 'enabled', mountStatus });
      const result = await pwaShareStatus(deps, 'json');
      expect(result.report?.mountStatus).toBe(mountStatus);
      expect(result.report?.urls.local).toBe('http://127.0.0.1:31415/app/');
      expect(result.report?.tailscale).toEqual({
        installed: state.probe.installed,
        alive: state.probe.alive,
        hostname: state.probe.hostname,
        magicDnsHost: state.probe.magicDnsHost,
        ips: state.probe.ips,
      });
      if (mountStatus === 'unmounted') {
        expect(result.report?.urls.tailnet).toBeUndefined();
      } else {
        expect(result.report?.urls.tailnet).toBe('https://mbp.tail-abc.ts.net:31415/app/');
      }
    }
  });

  test('uses the daemon-resolved non-default port for mount lookup and both URLs', async () => {
    const { deps } = mkDeps({ switchValue: 'enabled' });
    const mountPorts: number[] = [];
    const result = await pwaShareStatus({
      ...deps,
      port: undefined,
      resolveNexusPwaFn: () => ({ status: 'registered', loopback: 'http://127.0.0.1:31416/app/', url: 'http://127.0.0.1:31416/app/', source: 'local' }),
      mountStatusFn: async (_binary, port) => { mountPorts.push(port); return 'mounted'; },
    }, 'json');
    expect(mountPorts).toEqual([31416]);
    expect(result.report).toMatchObject({ mountStatus: 'mounted', port: 31416, portSource: 'nexus' });
    expect(result.report?.urls).toEqual({
      local: 'http://127.0.0.1:31416/app/',
      tailnet: 'https://mbp.tail-abc.ts.net:31416/app/',
    });
  });

  test('an explicit port overrides the daemon-resolved port', async () => {
    const { deps } = mkDeps({ switchValue: 'enabled' });
    const mountPorts: number[] = [];
    const result = await pwaShareStatus({
      ...deps,
      port: 31417,
      resolveNexusPwaFn: () => ({ status: 'registered', loopback: 'http://127.0.0.1:31416/app/', url: 'http://127.0.0.1:31416/app/', source: 'local' }),
      mountStatusFn: async (_binary, port) => { mountPorts.push(port); return 'mounted'; },
    }, 'json');
    expect(mountPorts).toEqual([31417]);
    expect(result.report).toMatchObject({ port: 31417, portSource: 'explicit' });
    expect(result.report?.urls.local).toBe('http://127.0.0.1:31417/app/');
  });

  test('missing, malformed, portless, or throwing daemon resolution leaves port and mount unknown', async () => {
    const resolutions: Array<() => NexusPwaResolution> = [
      () => ({ status: 'absent' as const, reason: 'daemon-absent' as const }),
      () => ({ status: 'registered' as const, loopback: 'not a URL', url: 'not a URL', source: 'local' as const }),
      () => ({ status: 'registered' as const, loopback: 'http://127.0.0.1/app/', url: 'http://127.0.0.1/app/', source: 'local' as const }),
      () => { throw new Error('resolver failure'); },
    ];
    for (const resolveNexusPwaFn of resolutions) {
      const { deps } = mkDeps({ switchValue: 'enabled' });
      let mountCalls = 0;
      const result = await pwaShareStatus({
        ...deps,
        port: undefined,
        resolveNexusPwaFn,
        mountStatusFn: async () => { mountCalls += 1; return 'unmounted'; },
      }, 'json');
      expect(mountCalls).toBe(0);
      expect(result.report).toMatchObject({ mountStatus: 'unknown', portSource: 'unknown' });
      expect(result.report?.port).toBeUndefined();
      expect(result.report?.urls).toEqual({ local: 'unknown (PWA port unavailable)' });
    }
  });
});
