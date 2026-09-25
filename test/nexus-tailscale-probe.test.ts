// P.3 — Tailscale probe unit coverage.

import { describe, expect, test } from 'bun:test';

import { probeTailscale } from '../src/nexus/onboarding/tailscale-probe.js';

const sampleStatus = JSON.stringify({
  BackendState: 'Running',
  Self: {
    HostName: 'mbp',
    DNSName: 'mbp.tail-abc.ts.net.',
    TailscaleIPs: ['100.64.0.2', 'fd7a:115c:a1e0::1'],
  },
});

describe('P.3 · probeTailscale', () => {
  test('installed + alive → parses host / DNS / IPs', async () => {
    const probe = await probeTailscale({
      candidates: ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'],
      existsFn: () => true,
      execFn: async () => ({ stdout: sampleStatus, code: 0 }),
    });
    expect(probe.installed).toBe(true);
    expect(probe.alive).toBe(true);
    expect(probe.hostname).toBe('mbp');
    expect(probe.magicDnsHost).toBe('mbp.tail-abc.ts.net'); // trailing dot stripped
    expect(probe.ips).toEqual(['100.64.0.2', 'fd7a:115c:a1e0::1']);
    expect(probe.binary).toBe('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
    expect(probe.backendState).toBe('Running');
  });

  test('installed + Stopped state → alive=false', async () => {
    const stopped = JSON.stringify({ BackendState: 'Stopped', Self: { HostName: 'mbp' } });
    const probe = await probeTailscale({
      candidates: ['/opt/homebrew/bin/tailscale'],
      existsFn: () => true,
      execFn: async () => ({ stdout: stopped, code: 0 }),
    });
    expect(probe.installed).toBe(true);
    expect(probe.alive).toBe(false);
    expect(probe.backendState).toBe('Stopped');
  });

  test('binary not found at any candidate → installed=false', async () => {
    const probe = await probeTailscale({
      candidates: ['/nope/a', '/nope/b'],
      existsFn: () => false,
      execFn: async () => { throw new Error('should not be called'); },
    });
    expect(probe.installed).toBe(false);
    expect(probe.alive).toBe(false);
    expect(probe.binary).toBeUndefined();
  });

  test('JSON parse error → installed=true, alive=false', async () => {
    const probe = await probeTailscale({
      candidates: ['/opt/homebrew/bin/tailscale'],
      existsFn: () => true,
      execFn: async () => ({ stdout: 'not-json{{', code: 0 }),
    });
    expect(probe.installed).toBe(true);
    expect(probe.alive).toBe(false);
    expect(probe.hostname).toBeUndefined();
  });

  test('exit code 127 (command not found) → installed=false', async () => {
    const probe = await probeTailscale({
      candidates: ['tailscale'],   // bare command — skip exists check
      execFn: async () => ({ stdout: '', code: 127 }),
    });
    expect(probe.installed).toBe(false);
    expect(probe.alive).toBe(false);
  });

  test('candidates list ordered by priority (first match wins)', async () => {
    const probed: string[] = [];
    await probeTailscale({
      candidates: [
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
        '/opt/homebrew/bin/tailscale',
      ],
      existsFn: (p) => p === '/opt/homebrew/bin/tailscale',
      execFn: async (binary) => {
        probed.push(binary);
        return { stdout: sampleStatus, code: 0 };
      },
    });
    expect(probed).toEqual(['/opt/homebrew/bin/tailscale']);  // app-path skipped (not exist)
  });
});
