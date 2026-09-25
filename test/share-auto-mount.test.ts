import { describe, expect, test } from 'bun:test';

import { mountShareIfEnabled } from '../src/cli/share-auto-mount.js';
import type { TailscaleProbe } from '../src/nexus/onboarding/tailscale-probe.js';

const TS_ALIVE: TailscaleProbe = {
  installed: true,
  alive: true,
  binary: '/opt/homebrew/bin/tailscale',
  hostname: 'mbp',
  magicDnsHost: 'mbp.tail-abc.ts.net',
  ips: ['100.64.0.2'],
  backendState: 'Running',
};
const TS_MISSING: TailscaleProbe = { installed: false, alive: false };
const TS_DOWN: TailscaleProbe = {
  installed: true,
  alive: false,
  binary: '/opt/homebrew/bin/tailscale',
  backendState: 'Stopped',
};

describe('mountShareIfEnabled', () => {
  test('switch=enabled mounts tailscale serve against the live port', async () => {
    let servedPort = -1;
    let servedBinary = '';
    const r = await mountShareIfEnabled({
      httpPort: 31420,
      readShareSwitchFn: () => 'enabled',
      shareProbeFn: async () => TS_ALIVE,
      shareServeFn: async (bin, port) => {
        servedBinary = bin;
        servedPort = port;
        return { exitCode: 0 };
      },
    });
    expect(r.outcome).toBe('serving');
    expect(servedPort).toBe(31420);
    expect(servedBinary).toBe('/opt/homebrew/bin/tailscale');
    expect(r.url).toBe('https://mbp.tail-abc.ts.net:31420/app/');
  });

  test('switch=disabled skips without calling serve', async () => {
    let serveCalls = 0;
    const r = await mountShareIfEnabled({
      httpPort: 31415,
      readShareSwitchFn: () => 'disabled',
      shareProbeFn: async () => TS_ALIVE,
      shareServeFn: async () => {
        serveCalls += 1;
        return { exitCode: 0 };
      },
    });
    expect(r.outcome).toBe('skipped');
    expect(r.reason).toBe('switch-disabled');
    expect(serveCalls).toBe(0);
  });

  test('switch=ask skips without calling serve', async () => {
    let serveCalls = 0;
    const r = await mountShareIfEnabled({
      httpPort: 31415,
      readShareSwitchFn: () => 'ask',
      shareProbeFn: async () => TS_ALIVE,
      shareServeFn: async () => {
        serveCalls += 1;
        return { exitCode: 0 };
      },
    });
    expect(r.outcome).toBe('skipped');
    expect(r.reason).toBe('switch-ask');
    expect(serveCalls).toBe(0);
  });

  test('https=true bypasses switch=disabled (force-enable for THIS run)', async () => {
    let servedPort = -1;
    const r = await mountShareIfEnabled({
      httpPort: 31420,
      https: true,
      readShareSwitchFn: () => 'disabled',
      shareProbeFn: async () => TS_ALIVE,
      shareServeFn: async (_bin, port) => {
        servedPort = port;
        return { exitCode: 0 };
      },
    });
    expect(r.outcome).toBe('serving');
    expect(servedPort).toBe(31420);
  });

  test('tailscale missing → skipped with reason', async () => {
    let serveCalls = 0;
    const r = await mountShareIfEnabled({
      httpPort: 31415,
      readShareSwitchFn: () => 'enabled',
      shareProbeFn: async () => TS_MISSING,
      shareServeFn: async () => {
        serveCalls += 1;
        return { exitCode: 0 };
      },
    });
    expect(r.outcome).toBe('skipped');
    expect(r.reason).toBe('tailscale-missing');
    expect(serveCalls).toBe(0);
  });

  test('tailscale installed but down → skipped with reason', async () => {
    let serveCalls = 0;
    const r = await mountShareIfEnabled({
      httpPort: 31415,
      readShareSwitchFn: () => 'enabled',
      shareProbeFn: async () => TS_DOWN,
      shareServeFn: async () => {
        serveCalls += 1;
        return { exitCode: 0 };
      },
    });
    expect(r.outcome).toBe('skipped');
    expect(r.reason).toBe('tailscale-down');
    expect(serveCalls).toBe(0);
  });

  test('serve non-zero exit → failed with reason + exit code', async () => {
    const r = await mountShareIfEnabled({
      httpPort: 31415,
      readShareSwitchFn: () => 'enabled',
      shareProbeFn: async () => TS_ALIVE,
      shareServeFn: async () => ({ exitCode: 7 }),
    });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toBe('serve-error');
    expect(r.serveExitCode).toBe(7);
  });

  test('url uses the actual live port (mount target = httpPort param)', async () => {
    const r = await mountShareIfEnabled({
      httpPort: 31499,
      readShareSwitchFn: () => 'enabled',
      shareProbeFn: async () => TS_ALIVE,
      shareServeFn: async () => ({ exitCode: 0 }),
    });
    expect(r.url).toBe('https://mbp.tail-abc.ts.net:31499/app/');
  });
});
