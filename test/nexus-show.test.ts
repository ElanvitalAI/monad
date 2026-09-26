// `elanous nexus show` — consolidated daemon overview tests.
//
// Composition: runNexusShow drives runPwaShow under a capturing sink,
// derives REST + SSE URLs from the same base, and prints a single
// human-readable block. JSON format pairs `instance` + a structured
// `urls: { pwa, rest, sse }` 3-way shape.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatRevisionLine, joinRestHealthUrl, resolveNexusPwa, runNexusShow, toLoopbackUrl } from '../src/cli/nexus-show';
import type { GitCommandRunner } from '../src/git-fs/runner';
import { runNexus } from '../src/nexus/index';
import { setTestStateRoot } from '../src/nexus/paths';
import { nexusRuntimePath } from '../src/nexus/paths';
import type { PwaInstanceListing } from '../src/cli/pwa-registry';
import type { TailscaleProbe } from '../src/nexus/onboarding/tailscale-probe';
import type { NexusLifecycleState } from '../src/nexus/supervisor/lock';

function makeOut(): { log: (s: string) => void; error: (s: string) => void; lines: string[] } {
  const lines: string[] = [];
  return {
    log: (s: string) => lines.push(s),
    error: (s: string) => lines.push(s),
    lines,
  };
}

function instance(overrides: Partial<PwaInstanceListing> = {}): PwaInstanceListing {
  return {
    pid: 12345,
    ports: [31415],
    mode: 'static',
    kind: 'production',
    cwd: '/tmp/myproj',
    daemonDir: '/Users/me/.elanous/nexus',
    shareMounted: false,
    https: false,
    startedAt: '2026-05-13T00:00:00.000Z',
    alive: true,
    ...overrides,
  } as PwaInstanceListing;
}

function probe(host?: string): TailscaleProbe {
  return {
    installed: true,
    alive: true,
    magicDnsHost: host ?? null,
    hostname: null,
    ips: [],
    tailnet: null,
    loginUrl: null,
  } as unknown as TailscaleProbe;
}

function lifecycle(overrides: Partial<NexusLifecycleState> = {}): NexusLifecycleState {
  return {
    root: '/Users/me/.elanous/nexus',
    lock: { pid: 54321 } as NexusLifecycleState['lock'],
    runtime: {
      pid: 54321,
      startedAt: '2026-08-19T00:00:00.000Z',
      nexusVersion: '1.0',
      phase: 'running',
      httpHost: '127.0.0.1',
      httpPort: 31416,
    },
    ...overrides,
  };
}

describe('resolveNexusPwa', () => {
  test('returns registered, unregistered-known, unregistered-unknown, and absent without output', () => {
    expect(resolveNexusPwa({ cwd: '/tmp/myproj', listFn: () => [instance({ ports: [31415] })] })).toEqual({
      status: 'registered', loopback: 'http://127.0.0.1:31415/app/', url: 'http://127.0.0.1:31415/app/', source: 'local',
    });
    expect(resolveNexusPwa({ cwd: '/tmp/myproj', listFn: () => [instance({ ports: [] })], lifecycleFn: () => lifecycle({ runtime: undefined }), nexusRootFn: () => '/Users/me/.elanous/nexus' })).toEqual({
      status: 'unregistered', reason: 'pwa-url-unknown', pid: 54321,
    });
    expect(resolveNexusPwa({ cwd: '/tmp/myproj', listFn: () => [instance({ ports: [65_536] })], lifecycleFn: () => lifecycle({ runtime: undefined }), nexusRootFn: () => '/Users/me/.elanous/nexus' })).toEqual({
      status: 'unregistered', reason: 'pwa-url-unknown', pid: 54321,
    });
    expect(resolveNexusPwa({ cwd: '/tmp/myproj', listFn: () => [], lifecycleFn: () => lifecycle(), nexusRootFn: () => '/Users/me/.elanous/nexus' })).toEqual({
      status: 'unregistered', loopback: 'http://127.0.0.1:31416/app/', url: 'http://127.0.0.1:31416/app/', pid: 54321, source: 'local',
    });
    expect(resolveNexusPwa({ cwd: '/tmp/myproj', listFn: () => [], lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, httpPort: undefined } }), nexusRootFn: () => '/Users/me/.elanous/nexus' })).toEqual({
      status: 'unregistered', reason: 'pwa-url-unknown', pid: 54321,
    });
    expect(resolveNexusPwa({ cwd: '/tmp/myproj', listFn: () => [], lifecycleFn: () => null })).toEqual({
      status: 'absent', reason: 'daemon-absent',
    });
    expect(resolveNexusPwa({ listFn: () => { throw new Error('unreadable registry'); } })).toEqual({
      status: 'absent', reason: 'pwa-query-failed',
    });
  });

  // 🆕 2026-09-24 — 바인드 와일드카드는 접속 주소가 아니다(데몬이 Host 0.0.0.0 을 403 으로 거절).
  test('a wildcard bind host becomes 127.0.0.1 in the loopback URL', () => {
    expect(toLoopbackUrl('http://0.0.0.0:31415/app/')).toBe('http://127.0.0.1:31415/app/');
    expect(toLoopbackUrl('http://[::]:31415/app/')).toBe('http://127.0.0.1:31415/app/');
    expect(toLoopbackUrl('http://127.0.0.1:31415/app/')).toBe('http://127.0.0.1:31415/app/');
    expect(toLoopbackUrl('http://0.0.0.0.example:1/')).toBe('http://0.0.0.0.example:1/');
    expect(resolveNexusPwa({
      cwd: '/tmp/myproj',
      pwaResult: { instance: instance({ ports: [31415] }), urls: { loopback: 'http://0.0.0.0:31415/app/' } },
      lifecycleFn: () => null,
    })).toMatchObject({ loopback: 'http://127.0.0.1:31415/app/' });
  });

  test('prefers the daemon-recorded tailnet URL over the local fallback', () => {
    expect(resolveNexusPwa({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, tailnetUrl: 'https://mbp.tailnet.ts.net:31416/app/', tailnetRecordedAt: '2026-08-19T00:01:00.000Z' } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
    })).toEqual({
      status: 'unregistered',
      loopback: 'http://127.0.0.1:31416/app/',
      url: 'https://mbp.tailnet.ts.net:31416/app/',
      pid: 54321,
      source: 'tailnet',
      tailnetRecordedAt: '2026-08-19T00:01:00.000Z',
    });
  });

  test.each(['2026-08-19T00:01:00Z', '2026-08-19T09:01:00+09:00', '2024-02-29T00:00:00Z'])(
    'preserves a valid ISO-8601 recorded tailnet timestamp: %p',
    (tailnetRecordedAt) => {
      expect(resolveNexusPwa({
        cwd: '/tmp/myproj',
        listFn: () => [],
        lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, tailnetUrl: 'https://mbp.tailnet.ts.net:31416/app/', tailnetRecordedAt } }),
        nexusRootFn: () => '/Users/me/.elanous/nexus',
      })).toEqual({
        status: 'unregistered',
        loopback: 'http://127.0.0.1:31416/app/',
        url: 'https://mbp.tailnet.ts.net:31416/app/',
        pid: 54321,
        source: 'tailnet',
        tailnetRecordedAt,
      });
    },
  );

  // `2026-02-30`/`2026-02-29`(2026 is not a leap year)/`2026-04-31` all pass the shape
  // regex and `Date.parse`, which silently rolls them into the next month.
  test.each(['', 'not-a-timestamp', 'August 19, 2026', '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z'])(
    'omits an invalid recorded tailnet timestamp: %p',
    (tailnetRecordedAt) => {
      expect(resolveNexusPwa({
        cwd: '/tmp/myproj',
        listFn: () => [],
        lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, tailnetUrl: 'https://mbp.tailnet.ts.net:31416/app/', tailnetRecordedAt } }),
        nexusRootFn: () => '/Users/me/.elanous/nexus',
      })).toEqual({
        status: 'unregistered',
        loopback: 'http://127.0.0.1:31416/app/',
        url: 'https://mbp.tailnet.ts.net:31416/app/',
        pid: 54321,
        source: 'tailnet',
      });
    },
  );

  test('prefers the live registered tailnet URL when no matching lifecycle sidecar exists', () => {
    expect(resolveNexusPwa({
      cwd: '/tmp/myproj',
      pwaResult: {
        instance: instance({ ports: [31415] }),
        urls: { loopback: 'http://127.0.0.1:31415/app/', tailnet: 'https://mbp.tailnet.ts.net:31415/app/' },
      },
      lifecycleFn: () => null,
    })).toEqual({
      status: 'registered',
      loopback: 'http://127.0.0.1:31415/app/',
      url: 'https://mbp.tailnet.ts.net:31415/app/',
      source: 'tailnet',
    });
  });

  test('does not combine a registered instance with a different runtime instance tailnet URL', () => {
    expect(resolveNexusPwa({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415] })],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, tailnetUrl: 'https://mbp.tailnet.ts.net:31416/app/' } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
    })).toEqual({
      status: 'registered',
      loopback: 'http://127.0.0.1:31415/app/',
      url: 'http://127.0.0.1:31415/app/',
      source: 'local',
    });
  });

  test.each(['', '   ', 'not-a-url', 'http://mbp.tailnet.ts.net:31416/app/', 'https://mbp.tailnet.ts.net:31416/other/'])(
    'falls back to the local URL for an invalid recorded tailnet URL: %p',
    (tailnetUrl) => {
      expect(resolveNexusPwa({
        cwd: '/tmp/myproj',
        listFn: () => [],
        lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, tailnetUrl } }),
        nexusRootFn: () => '/Users/me/.elanous/nexus',
      })).toEqual({
        status: 'unregistered', loopback: 'http://127.0.0.1:31416/app/', url: 'http://127.0.0.1:31416/app/', pid: 54321, source: 'local',
      });
    },
  );
});

describe('runNexus · tailnet runtime sidecar producer', () => {
  let stateRoot: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), 'elanous-nexus-show-'));
    setTestStateRoot(stateRoot);
  });

  afterEach(() => {
    setTestStateRoot(null);
    rmSync(stateRoot, { recursive: true, force: true });
  });

  async function runHeadlessShare(result: { outcome: 'serving'; url?: string }): Promise<Record<string, unknown>> {
    let finish!: () => void;
    let mountReturned = false;
    let observed!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const mounted = new Promise<void>((resolve) => { observed = resolve; });
    const boot = runNexus({
      headless: true,
      skipHeadlessSetupCheckForTesting: true,
      headlessDoneForTesting: done,
      autoMountShare: true,
      skipHttpServer: false,
      skipSupervisor: true,
      skipRuntimeApi: true,
      skipPushcutChannel: true,
      skipPwaChannel: true,
      skipTerminalChannel: true,
      skipDiscordChannel: true,
      skipIntentPrediction: true,
      mountShareIfEnabledFn: async () => {
        mountReturned = true;
        return result;
      },
      onRuntimeSidecarWrite: () => {
        if (mountReturned) observed();
      },
    });
    await mounted;
    const runtime = JSON.parse(readFileSync(nexusRuntimePath(), 'utf8')) as Record<string, unknown>;
    finish();
    await boot;
    return runtime;
  }

  test('records a complete serving URL and timestamp in the real headless auto-mount branch', async () => {
    const runtime = await runHeadlessShare({ outcome: 'serving', url: 'https://mbp.tailnet.ts.net:31415/app/' });
    expect(runtime).toMatchObject({ tailnetUrl: 'https://mbp.tailnet.ts.net:31415/app/' });
    expect(runtime.tailnetRecordedAt).toEqual(expect.any(String));
  });

  test('does not record tailnet fields when the real headless auto-mount result omits its URL', async () => {
    const runtime = await runHeadlessShare({ outcome: 'serving' });
    expect(runtime.tailnetUrl).toBeUndefined();
    expect(runtime.tailnetRecordedAt).toBeUndefined();
  });
});

// ── empty registry ───────────────────────────────────────────────────

describe('runNexusShow · no daemon registered', () => {
  test('human format prints the consolidated hint', async () => {
    const out = makeOut();
    const r = await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => null,
      out,
    });
    expect(r.exitCode).toBe(0);
    expect(r.instance).toBeUndefined();
    expect(out.lines.some((l) => l.includes('no daemon registered for this project'))).toBe(true);
    expect(out.lines.some((l) => l.includes('elanous nexus run --hmr'))).toBe(true);
    expect(out.lines.some((l) => l.includes('elanous nexus pwa global status'))).toBe(true);
  });

  test('json format emits null instance + cwd', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      format: 'json',
      lifecycleFn: () => null,
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { status: string; instance: unknown; urls: unknown; cwd: string };
    expect(body.status).toBe('absent');
    expect(body.instance).toBeNull();
    expect(body.urls).toBeNull();
    expect(body.cwd).toBe('/tmp/myproj');
  });
});

// ── unregistered lifecycle daemon ────────────────────────────────────

describe('runNexusShow · unregistered lifecycle daemon', () => {
  test('uses a live same-root sidecar for JSON and human URLs', async () => {
    const jsonOut = makeOut();
    const r = await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle(),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out: jsonOut,
    });
    const body = JSON.parse(jsonOut.lines.join('\n')) as {
      status: string;
      instance: unknown;
      urls: { pwa: { loopback: string }; rest: { loopback: string }; sse: { loopback: string } };
      http: string;
    };
    expect(r.status).toBe('unregistered');
    expect(body.status).toBe('unregistered');
    expect(body.instance).toBeNull();
    expect(body.http).toBe('known');
    expect(body.urls.pwa.loopback).toBe('http://127.0.0.1:31416/app/');
    expect(body.urls.rest.loopback).toBe('http://127.0.0.1:31416/v1/');
    expect(body.urls.sse.loopback).toBe('http://127.0.0.1:31416/v1/events');

    const humanOut = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle(),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      out: humanOut,
    });
    const humanOutput = humanOut.lines.join('\n');
    expect(humanOutput).toContain('daemon alive but not registered for this project');
    expect(humanOutput).toContain('PWA UI    http://127.0.0.1:31416/app/');
    expect(humanOut.lines.filter((line) => line.includes("These addresses come from this daemon's runtime sidecar")).length).toBe(1);
    expect(humanOutput).toContain('registry readers do not list this daemon: `elanous nexus pwa global status`');
  });

  test('renders a daemon-recorded tailnet address with the sidecar source notice without attributing it to registration', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, tailnetUrl: 'https://mbp.tailnet.ts.net:31416/app/' } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      out,
    });
    const output = out.lines.join('\n');
    expect(output).toContain('https://mbp.tailnet.ts.net:31416/app/  (tailnet)');
    expect(output).toContain("These addresses come from this daemon's runtime sidecar");
    expect(output).not.toContain('not registered because tailnet');
  });

  test('keeps incomplete sidecar HTTP metadata unknown without guessing URLs', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, httpPort: undefined } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { status: string; urls: unknown; http: string };
    expect(body.status).toBe('unregistered');
    expect(body.urls).toBeNull();
    expect(body.http).toBe('unknown');
  });

  test('keeps mismatched runtime PID unknown to avoid stale sidecar URLs', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, pid: 99999 } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { status: string; urls: unknown; http: string };
    expect(body).toMatchObject({ status: 'unregistered', urls: null, http: 'unknown' });
  });

  test.each([
    ['mismatched runtime PID', { pid: 99999 }],
    ['path in host', { httpHost: 'example.com/path' }],
    ['userinfo in host', { httpHost: 'user@example.com' }],
    ['malformed bracketed IPv6', { httpHost: '[::1' }],
  ])('reports invalid metadata rather than missing fields for %s', async (_name, runtimeOverrides) => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, ...runtimeOverrides } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      out,
    });
    expect(out.lines.join('\n')).toContain('HTTP      unknown (runtime sidecar metadata unavailable or invalid)');
  });

  test.each([
    ['rejects paths in hosts', { httpHost: 'example.com/path' }],
    ['rejects userinfo in hosts', { httpHost: 'user@example.com' }],
    ['rejects malformed bracketed IPv6', { httpHost: '[::1' }],
  ])('%s', async (_name, runtimeOverrides) => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, ...runtimeOverrides } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { urls: unknown; http: string };
    expect(body).toMatchObject({ urls: null, http: 'unknown' });
  });

  test.each([
    ['rejects port above the TCP range', { httpPort: 65_536 }],
    ['rejects blank hosts', { httpHost: '   ' }],
  ])('%s', async (_name, runtimeOverrides) => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, ...runtimeOverrides } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { urls: unknown; http: string };
    expect(body).toMatchObject({ urls: null, http: 'unknown' });
  });

  test('accepts HTTP default port 80 after URL normalization', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, httpPort: 80 } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { urls: { pwa: { loopback: string } }; http: string };
    expect(body.http).toBe('known');
    expect(body.urls.pwa.loopback).toBe('http://127.0.0.1/app/');
  });

  test('formats bracketed IPv6 literal hosts as valid URLs', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, httpHost: '[::1]' } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { urls: { pwa: { loopback: string } }; http: string };
    expect(body.http).toBe('known');
    expect(body.urls.pwa.loopback).toBe('http://[::1]:31416/app/');
  });

  test('accepts the lifecycle helper legacy test-state root', async () => {
    const out = makeOut();
    const r = await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ root: '/tmp/nexus-test-state' }),
      nexusRootFn: () => '/tmp/nexus-test-state/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { status: string; urls: { pwa: { loopback: string } } };
    expect(r.status).toBe('unregistered');
    expect(body.status).toBe('unregistered');
    expect(body.urls.pwa.loopback).toBe('http://127.0.0.1:31416/app/');
  });

  test('does not treat a different lifecycle root as this daemon', async () => {
    const out = makeOut();
    const r = await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ root: '/other/.elanous/nexus' }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { status: string; instance: unknown; urls: unknown };
    expect(r.status).toBe('absent');
    expect(body).toMatchObject({ status: 'absent', instance: null, urls: null });
  });

  test('includes the daemon-recorded tailnet link metadata for an unregistered instance', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [],
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, tailnetUrl: 'https://mbp.tailnet.ts.net:31416/app/', tailnetRecordedAt: '2026-08-19T09:01:00+09:00' } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as {
      urls: { pwa: { tailnet?: string } };
      link: { url: string; source: string; tailnetRecordedAt: string };
    };
    expect(body.urls.pwa.tailnet).toBe('https://mbp.tailnet.ts.net:31416/app/');
    expect(body.link).toEqual({
      url: 'https://mbp.tailnet.ts.net:31416/app/',
      source: 'tailnet',
      tailnetRecordedAt: '2026-08-19T09:01:00+09:00',
    });
  });

  test('keeps registered live-probe tailnet URLs and links consistent without a lifecycle sidecar', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415], shareMounted: true })],
      probeFn: async () => probe('mbp.tailnet.ts.net'),
      lifecycleFn: () => null,
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as {
      urls: { pwa: { tailnet?: string } };
      link: { url: string; source: string };
    };
    expect(body.urls.pwa.tailnet).toBe('https://mbp.tailnet.ts.net:31415/app/');
    expect(body.link).toEqual({ url: 'https://mbp.tailnet.ts.net:31415/app/', source: 'tailnet' });
  });

  test('drops a live tailnet URL the resolver rejected instead of re-inserting it into urls', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415], shareMounted: true })],
      probeFn: async () => probe('mbp.tailnet.ts.net/evil'),
      lifecycleFn: () => null,
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as {
      urls: { pwa: { tailnet?: string }; rest: { tailnet?: string }; sse: { tailnet?: string } };
      link: { url: string; source: string };
    };
    expect(body.link.source).toBe('local');
    expect(body.urls.pwa.tailnet).toBeUndefined();
    expect(body.urls.rest.tailnet).toBeUndefined();
    expect(body.urls.sse.tailnet).toBeUndefined();
  });

  test('uses the daemon-recorded tailnet URL for a registered instance', async () => {
    const out = makeOut();
    const r = await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31416] })],
      probeFn: async () => probe(),
      lifecycleFn: () => lifecycle({ runtime: { ...lifecycle().runtime!, tailnetUrl: 'https://mbp.tailnet.ts.net:31416/app/', tailnetRecordedAt: '2026-08-19T00:01:00.000Z' } }),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as {
      urls: { pwa: { loopback: string; tailnet?: string } };
      link: { url: string; source: string; tailnetRecordedAt: string };
    };
    expect(r.urls?.pwa.loopback).toBe('http://127.0.0.1:31416/app/');
    expect(r.urls?.pwa.tailnet).toBe('https://mbp.tailnet.ts.net:31416/app/');
    expect(body.urls.pwa.loopback).toBe('http://127.0.0.1:31416/app/');
    expect(body.urls.pwa.tailnet).toBe('https://mbp.tailnet.ts.net:31416/app/');
    expect(body.link).toEqual({
      url: 'https://mbp.tailnet.ts.net:31416/app/',
      source: 'tailnet',
      tailnetRecordedAt: '2026-08-19T00:01:00.000Z',
    });
  });

  test('preserves a registered instance over lifecycle data', async () => {
    const out = makeOut();
    const r = await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415] })],
      probeFn: async () => probe(),
      lifecycleFn: () => lifecycle(),
      nexusRootFn: () => '/Users/me/.elanous/nexus',
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as { status: string; instance: { pid: number }; urls: { pwa: { loopback: string } } };
    expect(r.status).toBe('registered');
    expect(body.status).toBe('registered');
    expect(body.instance.pid).toBe(12345);
    expect(body.urls.pwa.loopback).toBe('http://127.0.0.1:31415/app/');
  });
});

// ── alive · loopback only ────────────────────────────────────────────

describe('runNexusShow · alive daemon (loopback only)', () => {
  test('human output surfaces PWA / REST / SSE loopback URLs', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415] })],
      probeFn: async () => probe(),
      out,
    });
    const joined = out.lines.join('\n');
    expect(joined).toContain('elanous nexus daemon — ✓ alive');
    expect(joined).toContain('PWA UI    http://127.0.0.1:31415/app/');
    expect(joined).toContain('REST API  http://127.0.0.1:31415/v1/');
    expect(joined).toContain('SSE       http://127.0.0.1:31415/v1/events');
    expect(joined).toContain('tailnet off');
  });

  test('json output pairs instance + 3-way urls block', async () => {
    const out = makeOut();
    const r = await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415] })],
      probeFn: async () => probe(),
      format: 'json',
      out,
    });
    const body = JSON.parse(out.lines.join('\n')) as {
      instance: { pid: number; ports: number[] };
      urls: {
        pwa: { loopback: string; tailnet?: string };
        rest: { loopback: string; tailnet?: string };
        sse: { loopback: string; tailnet?: string };
      };
    };
    expect(body.instance.pid).toBe(12345);
    expect(body.urls.pwa.loopback).toBe('http://127.0.0.1:31415/app/');
    expect(body.urls.rest.loopback).toBe('http://127.0.0.1:31415/v1/');
    expect(body.urls.sse.loopback).toBe('http://127.0.0.1:31415/v1/events');
    expect(body.urls.pwa.tailnet).toBeUndefined();
    expect(body.urls.rest.tailnet).toBeUndefined();
    expect(body.urls.sse.tailnet).toBeUndefined();
    expect(r.urls?.pwa.loopback).toBe('http://127.0.0.1:31415/app/');
  });
});

// ── alive + share mounted · tailnet variants ─────────────────────────

describe('runNexusShow · share mounted (tailnet)', () => {
  test('human output shows tailnet variants for every surface', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415], shareMounted: true })],
      probeFn: async () => probe('mbp.tailnet-example.ts.net'),
      out,
    });
    const joined = out.lines.join('\n');
    expect(joined).toContain('PWA UI    http://127.0.0.1:31415/app/');
    expect(joined).toContain('https://mbp.tailnet-example.ts.net:31415/app/');
    expect(joined).toContain('REST API  http://127.0.0.1:31415/v1/');
    expect(joined).toContain('https://mbp.tailnet-example.ts.net:31415/v1/');
    expect(joined).toContain('SSE       http://127.0.0.1:31415/v1/events');
    expect(joined).toContain('https://mbp.tailnet-example.ts.net:31415/v1/events');
  });

  test('share mounted but Tailscale unreachable surfaces the recovery hint', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415], shareMounted: true })],
      probeFn: async () => ({ installed: false, alive: false } as unknown as TailscaleProbe),
      out,
    });
    const joined = out.lines.join('\n');
    expect(joined).toContain('Tailscale unreachable');
  });

  test('json output includes tailnet keys on all three surfaces', async () => {
    const out = makeOut();
    const r = await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415], shareMounted: true })],
      probeFn: async () => probe('mbp.tailnet-example.ts.net'),
      format: 'json',
      out,
    });
    expect(r.urls?.pwa.tailnet).toBe('https://mbp.tailnet-example.ts.net:31415/app/');
    expect(r.urls?.rest.tailnet).toBe('https://mbp.tailnet-example.ts.net:31415/v1/');
    expect(r.urls?.sse.tailnet).toBe('https://mbp.tailnet-example.ts.net:31415/v1/events');
  });
});

// ── stale daemon (pid dead) ──────────────────────────────────────────

describe('runNexusShow · stale daemon', () => {
  test('surfaces the stale tag without crashing the URL derivation', async () => {
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ alive: false })],
      probeFn: async () => probe(),
      out,
    });
    const joined = out.lines.join('\n');
    expect(joined).toContain('✗ stale (pid dead)');
    // URLs still computed — the user might want to inspect the
    // dangling lock or curl one last time before cleanup.
    expect(joined).toContain('PWA UI    http://127.0.0.1:31415/app/');
  });
});

// ── health URL join + revision diagnostics ──────────────────────────

describe('joinRestHealthUrl', () => {
  test('produces the same health address whether the REST base ends with a slash or not', () => {
    expect(joinRestHealthUrl('http://127.0.0.1:31415/v1/')).toBe('http://127.0.0.1:31415/v1/health');
    expect(joinRestHealthUrl('http://127.0.0.1:31415/v1')).toBe('http://127.0.0.1:31415/v1/health');
    expect(joinRestHealthUrl('http://127.0.0.1:31415/v1/', '/health')).toBe('http://127.0.0.1:31415/v1/health');
    expect(joinRestHealthUrl('http://127.0.0.1:31415/v1/', 'health')).toBe('http://127.0.0.1:31415/v1/health');
  });
});

describe('formatRevisionLine', () => {
  test('distinguishes a missing health response from a response that omits the commit SHA', () => {
    expect(formatRevisionLine(null)).toBe('revision  unavailable (no daemon health response)');
    expect(formatRevisionLine(undefined)).toBe('revision  unavailable (no daemon health response)');
    expect(formatRevisionLine({})).toBe('revision  unavailable (daemon health response has no commit SHA)');
    expect(formatRevisionLine({ daemonSha: '   ' })).toBe('revision  unavailable (daemon health response has no commit SHA)');
    expect(formatRevisionLine({ daemonSha: '47c566ac6' })).toBe('revision  47c566ac6');
  });
});

describe('runNexusShow · health probe URL and revision lines', () => {
  function gitForRevision(
    overrides: Partial<Record<'commit' | 'trackingRef' | 'trackingCommit' | 'count', { status: number; stdout: string }>> = {},
  ): { gitFn: GitCommandRunner; calls: string[][]; lazyFetchValues: Array<string | undefined> } {
    const calls: string[][] = [];
    const lazyFetchValues: Array<string | undefined> = [];
    const responses = {
      commit: { status: 0, stdout: '', ...overrides.commit },
      trackingRef: { status: 0, stdout: 'refs/remotes/origin/main\n', ...overrides.trackingRef },
      trackingCommit: { status: 0, stdout: 'abc123\n', ...overrides.trackingCommit },
      count: { status: 0, stdout: '0\n', ...overrides.count },
    };
    return {
      calls,
      lazyFetchValues,
      gitFn: (_cwd, args, options) => {
        calls.push(args);
        lazyFetchValues.push(options.env?.GIT_NO_LAZY_FETCH as string | undefined);
        const response = args[0] === 'symbolic-ref'
          ? responses.trackingRef
          : args[0] === 'rev-parse'
            ? (args.at(-1)?.startsWith('refs/remotes/') ? responses.trackingCommit : responses.commit)
            : responses.count;
        return { ...response, stderr: '' };
      },
    };
  }

  test('hands the probe seam a health URL with no doubled slash from the trailing-slash REST base', async () => {
    const seen: string[] = [];
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415] })],
      probeFn: async () => probe(),
      healthFn: async (url) => {
        seen.push(url);
        return { daemonSha: '47c566ac6' };
      },
      gitFn: gitForRevision({ count: { status: 0, stdout: '3\n' } }).gitFn,
      out,
    });
    expect(seen).toEqual(['http://127.0.0.1:31415/v1/health']);
    expect(seen[0]).not.toContain('//health');
    expect(out.lines.join('\n')).toContain('revision  47c566ac6 (3 commits behind)');
  });

  test.each([
    ['zero behind', {}, 'revision  47c566ac6 (0 commits behind)'],
    ['daemon commit unavailable locally', { commit: { status: 1, stdout: '' } }, 'revision  47c566ac6 (daemon commit unavailable locally)'],
    ['tracking ref unavailable locally', { trackingRef: { status: 1, stdout: '' } }, 'revision  47c566ac6 (remote default-branch tracking ref unavailable locally)'],
    ['symbolic tracking ref target unavailable locally', { trackingCommit: { status: 1, stdout: '' } }, 'revision  47c566ac6 (remote default-branch tracking ref unavailable locally)'],
    ['failed comparison', { count: { status: 128, stdout: '' } }, 'revision  47c566ac6 (freshness unavailable)'],
    ['malformed comparison', { count: { status: 0, stdout: 'not-a-count\n' } }, 'revision  47c566ac6 (freshness unavailable)'],
  ] as const)('renders %s without treating unavailable data as zero', async (_name, overrides, expected) => {
    const out = makeOut();
    const git = gitForRevision(overrides);
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415] })],
      probeFn: async () => probe(),
      healthFn: async () => ({ daemonSha: '47c566ac6' }),
      gitFn: git.gitFn,
      out,
    });
    const revision = out.lines.find((line) => line.startsWith('  revision'));
    expect(revision).toBe(`  ${expected}`);
    expect(revision).not.toMatch(/unavailable locally.*0|0.*unavailable locally/);
    expect(git.lazyFetchValues).toEqual(git.calls.map(() => '1'));
    expect(git.calls.flat()).not.toContain('fetch');
    expect(git.calls.flat()).not.toContain('ls-remote');
  });

  test('uses actual Git refs to distinguish an absent daemon commit and deleted origin/HEAD target', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-show-git-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      return result.stdout.trim();
    };
    try {
      git('init', '--initial-branch=main');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      git('commit', '--allow-empty', '-m', 'initial');
      const daemonSha = git('rev-parse', 'HEAD');
      git('update-ref', 'refs/remotes/origin/main', daemonSha);
      git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

      const missingDaemonOut = makeOut();
      await runNexusShow({
        cwd: dir,
        listFn: () => [instance({ cwd: dir, ports: [31415] })],
        probeFn: async () => probe(),
        healthFn: async () => ({ daemonSha: '0123456789012345678901234567890123456789' }),
        out: missingDaemonOut,
      });
      expect(missingDaemonOut.lines).toContain('  revision  0123456789012345678901234567890123456789 (daemon commit unavailable locally)');

      git('update-ref', '-d', 'refs/remotes/origin/main');
      const missingTrackingOut = makeOut();
      await runNexusShow({
        cwd: dir,
        listFn: () => [instance({ cwd: dir, ports: [31415] })],
        probeFn: async () => probe(),
        healthFn: async () => ({ daemonSha }),
        out: missingTrackingOut,
      });
      expect(missingTrackingOut.lines).toContain(`  revision  ${daemonSha} (remote default-branch tracking ref unavailable locally)`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prints a no-response revision line when the probe returns nothing', async () => {
    const seen: string[] = [];
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415] })],
      probeFn: async () => probe(),
      healthFn: async (url) => {
        seen.push(url);
        return null;
      },
      out,
    });
    expect(seen).toEqual(['http://127.0.0.1:31415/v1/health']);
    const joined = out.lines.join('\n');
    expect(joined).toContain('revision  unavailable (no daemon health response)');
    expect(joined).not.toContain('daemon health response has no commit SHA');
  });

  test('prints a missing-SHA revision line when the probe returns a body without daemonSha', async () => {
    const seen: string[] = [];
    const out = makeOut();
    await runNexusShow({
      cwd: '/tmp/myproj',
      listFn: () => [instance({ ports: [31415] })],
      probeFn: async () => probe(),
      healthFn: async (url) => {
        seen.push(url);
        return {};
      },
      out,
    });
    expect(seen).toEqual(['http://127.0.0.1:31415/v1/health']);
    const joined = out.lines.join('\n');
    expect(joined).toContain('revision  unavailable (daemon health response has no commit SHA)');
    expect(joined).not.toContain('no daemon health response');
  });
});
