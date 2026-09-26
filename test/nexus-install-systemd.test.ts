// NEXUS · systemd-user install tests (Phase N-5 PR ω)

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  SYSTEMD_UNIT_NAME,
  installSystemd,
  renderSystemdServiceUnit,
  resolveSystemdEnvironment,
  statusSystemd,
  uninstallSystemd,
} from '../src/nexus/install/systemd.js';
import { makeStubRunCli } from '../src/nexus/config/secrets/cli-helper.js';
import { PROVIDER_ENV_SPEC } from '../src/setup/llm-env-detect.js';

const PROVIDER_KEY_NAMES = [...new Set(PROVIDER_ENV_SPEC.flatMap((s) => [s.primaryKeyEnv, ...(s.aliasKeyEnvs ?? [])]).filter((n): n is string => Boolean(n)))];

let tmpRoot: string;
let unitDir: string;
let prevEnv: string | undefined;
let prevKeyCacheDir: string | undefined;
let prevProviderKeys: Record<string, string | undefined> = {};

beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'elanous-nexus-omega-'));
  unitDir = joinPath(tmpRoot, 'systemd', 'user');
  prevEnv = process.env.ELANOUS_NEXUS_DIR;
  process.env.ELANOUS_NEXUS_DIR = tmpRoot;
  // ⛔ install 이 셸 키를 키 캐시로 옮긴다(RFC S1b) — 시험은 실물 ~/.cache 에 닿으면 안 된다.
  prevKeyCacheDir = process.env.ELANOUS_KEY_CACHE_DIR;
  process.env.ELANOUS_KEY_CACHE_DIR = joinPath(tmpRoot, 'key-cache');
  prevProviderKeys = Object.fromEntries(PROVIDER_KEY_NAMES.map((n) => [n, process.env[n]]));
  for (const n of PROVIDER_KEY_NAMES) delete process.env[n];
});

afterEach(() => {
  if (prevKeyCacheDir === undefined) delete process.env.ELANOUS_KEY_CACHE_DIR; else process.env.ELANOUS_KEY_CACHE_DIR = prevKeyCacheDir;
  for (const [n, v] of Object.entries(prevProviderKeys)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
  if (prevEnv === undefined) delete process.env.ELANOUS_NEXUS_DIR;
  else process.env.ELANOUS_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('renderSystemdServiceUnit · structure', () => {
  test('emits Unit / Service / Install sections + Restart=on-failure', () => {
    const body = renderSystemdServiceUnit({
      command: ['/usr/local/bin/elanous', 'nexus', 'run'],
      workingDirectory: '/home/x',
      stdoutPath: '/home/x/.elanous/nexus/logs/nexus-stdout.log',
      stderrPath: '/home/x/.elanous/nexus/logs/nexus-stderr.log',
    });
    expect(body).toContain('[Unit]');
    expect(body).toContain('Description=elanous NEXUS');
    expect(body).toContain('[Service]');
    expect(body).toContain('Type=simple');
    expect(body).toContain('ExecStart=/usr/local/bin/elanous nexus run');
    expect(body).toContain('WorkingDirectory=/home/x');
    expect(body).toContain('Restart=on-failure');
    expect(body).toContain('RestartSec=10');
    expect(body).toContain('StandardOutput=append:/home/x/.elanous/nexus/logs/nexus-stdout.log');
    expect(body).toContain('StandardError=append:/home/x/.elanous/nexus/logs/nexus-stderr.log');
    expect(body).toContain('[Install]');
    expect(body).toContain('WantedBy=default.target');
  });

  test('quotes ExecStart args containing spaces / specials', () => {
    const body = renderSystemdServiceUnit({
      command: ['/bin/elanous', 'nexus', 'run', '--config=/path with spaces/cfg'],
      workingDirectory: '/home/x',
      stdoutPath: '/home/x/o',
      stderrPath: '/home/x/e',
    });
    expect(body).toContain('ExecStart=/bin/elanous nexus run "--config=/path with spaces/cfg"');
  });

  test('emits Environment lines for each env var', () => {
    const body = renderSystemdServiceUnit({
      command: ['/bin/elanous'],
      workingDirectory: '/home/x',
      stdoutPath: '/home/x/o',
      stderrPath: '/home/x/e',
      env: { HOME: '/home/x', PATH: '/usr/bin' },
    });
    expect(body).toContain('Environment="HOME=/home/x"');
    expect(body).toContain('Environment="PATH=/usr/bin"');
  });

  test('omits Environment lines when env is empty', () => {
    const body = renderSystemdServiceUnit({
      command: ['/bin/elanous'],
      workingDirectory: '/home/x',
      stdoutPath: '/home/x/o',
      stderrPath: '/home/x/e',
    });
    expect(body).not.toContain('Environment=');
  });

  test('determinism: same inputs produce byte-identical output', () => {
    const opts = {
      command: ['/usr/local/bin/elanous', 'nexus', 'run'],
      workingDirectory: '/home/x',
      stdoutPath: '/home/x/o',
      stderrPath: '/home/x/e',
    };
    expect(renderSystemdServiceUnit(opts)).toBe(renderSystemdServiceUnit(opts));
  });

  test('restart override propagates', () => {
    const body = renderSystemdServiceUnit({
      command: ['/bin/x'],
      workingDirectory: '/',
      stdoutPath: '/o',
      stderrPath: '/e',
      restartSeconds: 30,
    });
    expect(body).toContain('RestartSec=30');
  });
});

describe('resolveSystemdEnvironment', () => {
  test('uses ~/.config/systemd/user as the unit dir by default', () => {
    const env = resolveSystemdEnvironment({
      platformOverride: 'linux',
      unitDir,
    });
    expect(env.platform).toBe('linux');
    expect(env.unitName).toBe(SYSTEMD_UNIT_NAME);
    expect(env.unitPath).toBe(joinPath(unitDir, SYSTEMD_UNIT_NAME));
  });
});

describe('installSystemd · platform guard', () => {
  test('non-linux → not-supported (no fs side-effects)', async () => {
    let writeCalls = 0;
    const res = await installSystemd({
      platformOverride: 'darwin',
      unitDir,
      writeUnit: () => { writeCalls += 1; },
    });
    expect(res.outcome).toBe('not-supported');
    if (res.outcome === 'not-supported') {
      expect(res.reason).toContain('Linux-only');
    }
    expect(writeCalls).toBe(0);
  });
});

describe('installSystemd · happy path', () => {
  test('writes the unit + daemon-reload + enable + start (default)', async () => {
    const calls: string[][] = [];
    const stub = makeStubRunCli({
      systemctl: (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; },
    });
    const res = await installSystemd({
      platformOverride: 'linux',
      unitDir,
      command: ['/usr/local/bin/elanous', 'nexus', 'run'],
      runCli: stub,
    });
    expect(res.outcome).toBe('installed');
    if (res.outcome !== 'installed') return;
    expect(res.enabled).toBe(true);
    expect(res.started).toBe(true);
    expect(existsSync(res.unitPath)).toBe(true);
    const body = readFileSync(res.unitPath, 'utf-8');
    expect(body).toContain('ExecStart=/usr/local/bin/elanous nexus run');
    expect(calls.length).toBe(3);
    expect(calls[0]).toEqual(['systemctl', '--user', 'daemon-reload']);
    expect(calls[1]).toEqual(['systemctl', '--user', 'enable', SYSTEMD_UNIT_NAME]);
    expect(calls[2]).toEqual(['systemctl', '--user', 'start', SYSTEMD_UNIT_NAME]);
  });

  test('--no-start runs daemon-reload but skips enable + start', async () => {
    const calls: string[][] = [];
    const stub = makeStubRunCli({
      systemctl: (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; },
    });
    const res = await installSystemd({
      platformOverride: 'linux',
      unitDir,
      noStart: true,
      runCli: stub,
    });
    expect(res.outcome).toBe('installed');
    if (res.outcome !== 'installed') return;
    expect(res.enabled).toBe(false);
    expect(res.started).toBe(false);
    expect(existsSync(res.unitPath)).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['systemctl', '--user', 'daemon-reload']);
  });

  // 🆕 2026-09-24 (RFC S1b) — launchd 와 같은 계약: 키는 유닛에 안 굽고 키 캐시(600)로. 이미 있으면 덮지 않는다.
  test('moves a shell-only provider key into the key cache (600) and never into the unit', async () => {
    const secret = 'shell-only-openai-key-for-systemd-test';
    process.env.OPENAI_API_KEY = secret;
    const stub = makeStubRunCli({ systemctl: () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    const res = await installSystemd({ platformOverride: 'linux', unitDir, noStart: true, runCli: stub });
    expect(res.outcome).toBe('installed');
    if (res.outcome !== 'installed') return;
    expect(readFileSync(res.unitPath, 'utf-8')).not.toContain(secret);
    const cacheFile = joinPath(process.env.ELANOUS_KEY_CACHE_DIR!, 'openai_api_key');
    expect(readFileSync(cacheFile, 'utf-8').trim()).toBe(secret);
    expect(statSync(cacheFile).mode & 0o777).toBe(0o600);
    expect(res.keyCache).toEqual({ written: ['OPENAI_API_KEY'], differs: [] });
    // 둘째 설치: 캐시가 있으면 덮지 않고, 다르면 이름만 말한다
    process.env.OPENAI_API_KEY = 'a-different-shell-value';
    const again = await installSystemd({ platformOverride: 'linux', unitDir, noStart: true, runCli: stub });
    if (again.outcome !== 'installed') throw new Error('expected installed');
    expect(again.keyCache).toEqual({ written: [], differs: ['OPENAI_API_KEY'] });
    expect(readFileSync(cacheFile, 'utf-8').trim()).toBe(secret);
  });

  test('daemon-reload failure → outcome:error', async () => {
    const stub = makeStubRunCli({
      systemctl: () => ({ exitCode: 1, stdout: '', stderr: 'failed' }),
    });
    const res = await installSystemd({
      platformOverride: 'linux',
      unitDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('error');
    if (res.outcome !== 'error') return;
    expect(res.reason).toContain('daemon-reload');
  });

  test('enable failure surfaces error + leaves unit on disk', async () => {
    const stub = makeStubRunCli({
      systemctl: (cmd) => {
        if (cmd[2] === 'daemon-reload') return { exitCode: 0, stdout: '', stderr: '' };
        if (cmd[2] === 'enable') return { exitCode: 1, stdout: '', stderr: 'no permission' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const res = await installSystemd({
      platformOverride: 'linux',
      unitDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('error');
    if (res.outcome !== 'error') return;
    expect(res.reason).toContain('enable');
    expect(existsSync(res.unitPath!)).toBe(true);
  });
});

describe('uninstallSystemd', () => {
  test('stop + disable + unit removed → outcome:uninstalled', async () => {
    // Pre-write a unit with --no-start.
    await installSystemd({
      platformOverride: 'linux',
      unitDir,
      noStart: true,
      runCli: makeStubRunCli({ systemctl: () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
    });
    const calls: string[][] = [];
    const stub = makeStubRunCli({
      systemctl: (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; },
    });
    const res = await uninstallSystemd({
      platformOverride: 'linux',
      unitDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('uninstalled');
    if (res.outcome !== 'uninstalled') return;
    expect(res.stopped).toBe(true);
    expect(res.disabled).toBe(true);
    expect(res.removedFile).toBe(true);
    expect(existsSync(res.unitPath)).toBe(false);
    // stop · disable · daemon-reload (post-remove)
    expect(calls[0]).toEqual(['systemctl', '--user', 'stop', SYSTEMD_UNIT_NAME]);
    expect(calls[1]).toEqual(['systemctl', '--user', 'disable', SYSTEMD_UNIT_NAME]);
    expect(calls[2]).toEqual(['systemctl', '--user', 'daemon-reload']);
  });

  test('no unit + stop/disable both fail → outcome:not-installed', async () => {
    const stub = makeStubRunCli({
      systemctl: () => ({ exitCode: 1, stdout: '', stderr: '' }),
    });
    const res = await uninstallSystemd({
      platformOverride: 'linux',
      unitDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('not-installed');
  });

  test('platform guard — non-linux returns not-supported', async () => {
    const res = await uninstallSystemd({
      platformOverride: 'darwin',
      unitDir,
    });
    expect(res.outcome).toBe('not-supported');
  });
});

describe('statusSystemd', () => {
  test('is-active=active → outcome:running with enabled flag', async () => {
    const stub = makeStubRunCli({
      systemctl: (cmd) => {
        if (cmd[2] === 'is-active') return { exitCode: 0, stdout: 'active\n', stderr: '' };
        if (cmd[2] === 'is-enabled') return { exitCode: 0, stdout: 'enabled\n', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const res = await statusSystemd({
      platformOverride: 'linux',
      unitDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('running');
    if (res.outcome !== 'running') return;
    expect(res.enabled).toBe(true);
  });

  test('is-active=inactive but unit on disk → outcome:loaded', async () => {
    // Pre-write a unit so existsSync passes.
    await installSystemd({
      platformOverride: 'linux',
      unitDir,
      noStart: true,
      runCli: makeStubRunCli({ systemctl: () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
    });
    const stub = makeStubRunCli({
      systemctl: (cmd) => {
        if (cmd[2] === 'is-active') return { exitCode: 3, stdout: 'inactive\n', stderr: '' };
        if (cmd[2] === 'is-enabled') return { exitCode: 1, stdout: 'disabled\n', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const res = await statusSystemd({
      platformOverride: 'linux',
      unitDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('loaded');
    if (res.outcome !== 'loaded') return;
    expect(res.enabled).toBe(false);
  });

  test('no unit + is-active fails → outcome:not-loaded', async () => {
    const stub = makeStubRunCli({
      systemctl: () => ({ exitCode: 4, stdout: '', stderr: 'no such unit' }),
    });
    const res = await statusSystemd({
      platformOverride: 'linux',
      unitDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('not-loaded');
  });

  test('platform guard — non-linux returns not-supported', async () => {
    const res = await statusSystemd({
      platformOverride: 'darwin',
      unitDir,
    });
    expect(res.outcome).toBe('not-supported');
  });
});

// 🆕 2026-09-24 빈 Ubuntu VM 실측 — 로그 폴더가 없으면 systemd 가 209/STDOUT 으로 죽었다.
describe('installSystemd · log directory', () => {
  test('creates the stdout/stderr directories before writing the unit', async () => {
    const root = mkdtempSync(joinPath(tmpdir(), 'elanous-systemd-logs-'));
    try {
      const order: string[] = [];
      const res = await installSystemd({
        platformOverride: 'linux',
        unitDir: joinPath(root, 'units'),
        stdoutPath: joinPath(root, 'fresh', 'logs', 'out.log'),
        stderrPath: joinPath(root, 'fresh', 'logs', 'err.log'),
        env: { X: '1' },
        noStart: true,
        runCli: makeStubRunCli({ systemctl: () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
        writeUnit: () => { order.push(existsSync(joinPath(root, 'fresh', 'logs')) ? 'unit-after-dir' : 'unit-before-dir'); },
      });
      expect(res.outcome).not.toBe('error');
      expect(existsSync(joinPath(root, 'fresh', 'logs'))).toBe(true);
      expect(order).toEqual(['unit-after-dir']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// 🆕 2026-09-24 빈 Ubuntu VM 실측 — Linger=no 면 재부팅 뒤 로그인할 때까지 데몬이 안 뜬다.
describe('installSystemd · linger', () => {
  test('enables linger for the user after start, and reports a failure without failing the install', async () => {
    const seen: string[][] = [];
    const ok = await installSystemd({
      platformOverride: 'linux', unitDir, command: ['/b/bun', 'x'], user: 'alice', env: { X: '1' },
      runCli: makeStubRunCli({ systemctl: () => ({ exitCode: 0, stdout: '', stderr: '' }), loginctl: (cmd) => { seen.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; } }),
    });
    expect(seen).toEqual([['loginctl', 'enable-linger', 'alice']]);
    expect(ok).toMatchObject({ outcome: 'installed', linger: { ok: true } });
    const bad = await installSystemd({
      platformOverride: 'linux', unitDir, command: ['/b/bun', 'x'], user: 'alice', env: { X: '1' },
      runCli: makeStubRunCli({ systemctl: () => ({ exitCode: 0, stdout: '', stderr: '' }), loginctl: () => ({ exitCode: 1, stdout: '', stderr: 'Access denied' }) }),
    });
    expect(bad).toMatchObject({ outcome: 'installed', linger: { ok: false } });
    if (bad.outcome === 'installed') expect(bad.linger?.detail).toContain('sudo loginctl enable-linger alice');
  });
});
