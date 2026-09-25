// NEXUS · launchd install tests (Phase N-5 PR ψ)

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  LAUNCHD_LABEL,
  installLaunchd,
  renderAuxiliaryAiEnvNotice,
  renderLaunchdPlist,
  resolveLaunchdEnvironment,
  statusLaunchd,
  uninstallLaunchd,
} from '../src/nexus/install/launchd.js';
import { makeStubRunCli } from '../src/nexus/config/secrets/cli-helper.js';
import { AUXILIARY_AI_ENV_VARS, PROVIDER_ENV_SPEC } from '../src/setup/llm-env-detect.js';

let tmpRoot: string;
let plistDir: string;
let prevEnv: string | undefined;
let prevKeyCacheDir: string | undefined;
let previousDetectedEnv: Record<string, string | undefined>;

const detectedEnvNames = [
  ...AUXILIARY_AI_ENV_VARS.map(({ name }) => name),
  ...PROVIDER_ENV_SPEC.flatMap(({ primaryKeyEnv, aliasKeyEnvs, modelEnv, baseUrlEnv }) => [
    primaryKeyEnv,
    ...(aliasKeyEnvs ?? []),
    modelEnv,
    baseUrlEnv,
  ]).filter((name): name is string => Boolean(name)),
];

beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'monad-nexus-psi-'));
  plistDir = joinPath(tmpRoot, 'LaunchAgents');
  prevEnv = process.env.MONAD_NEXUS_DIR;
  previousDetectedEnv = Object.fromEntries(detectedEnvNames.map(name => [name, process.env[name]]));
  for (const name of detectedEnvNames) delete process.env[name];
  process.env.MONAD_NEXUS_DIR = tmpRoot;
  // ⛔ install 이 셸 키를 키 캐시로 옮긴다(RFC S1) — 시험은 실물 ~/.cache 에 닿으면 안 된다.
  prevKeyCacheDir = process.env.MONAD_KEY_CACHE_DIR;
  process.env.MONAD_KEY_CACHE_DIR = joinPath(tmpRoot, 'key-cache');
});

afterEach(() => {
  if (prevKeyCacheDir === undefined) delete process.env.MONAD_KEY_CACHE_DIR;
  else process.env.MONAD_KEY_CACHE_DIR = prevKeyCacheDir;
  if (prevEnv === undefined) delete process.env.MONAD_NEXUS_DIR;
  else process.env.MONAD_NEXUS_DIR = prevEnv;
  for (const name of detectedEnvNames) {
    const value = previousDetectedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('renderLaunchdPlist · structure + escaping', () => {
  test('emits the required keys (Label / ProgramArguments / KeepAlive / ThrottleInterval)', () => {
    const xml = renderLaunchdPlist({
      command: ['/usr/local/bin/monad', 'nexus', 'run'],
      workingDirectory: '/Users/x',
      stdoutPath: '/Users/x/.monad/nexus/logs/nexus-stdout.log',
      stderrPath: '/Users/x/.monad/nexus/logs/nexus-stderr.log',
    });
    expect(xml).toContain('<key>Label</key>');
    expect(xml).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(xml).toContain('<key>ProgramArguments</key>');
    expect(xml).toContain('<string>/usr/local/bin/monad</string>');
    expect(xml).toContain('<string>nexus</string>');
    expect(xml).toContain('<string>run</string>');
    expect(xml).toContain('<key>KeepAlive</key>');
    expect(xml).toContain('<key>SuccessfulExit</key>');
    expect(xml).toContain('<key>ThrottleInterval</key>');
    expect(xml).toContain('<integer>10</integer>');
    expect(xml).toContain('<key>WorkingDirectory</key>');
    expect(xml).toContain('<string>/Users/x</string>');
    expect(xml).toContain('<string>/Users/x/.monad/nexus/logs/nexus-stdout.log</string>');
    expect(xml).toContain('<string>/Users/x/.monad/nexus/logs/nexus-stderr.log</string>');
  });

  test('XML-escapes path components with special characters', () => {
    const xml = renderLaunchdPlist({
      command: ['/usr/local/bin/monad'],
      workingDirectory: "/Users/I'm a&b/x",
      stdoutPath: '/tmp/<a>.log',
      stderrPath: '/tmp/y.log',
    });
    expect(xml).toContain('/Users/I&apos;m a&amp;b/x');
    expect(xml).toContain('/tmp/&lt;a&gt;.log');
  });

  test('throttle override + custom label', () => {
    const xml = renderLaunchdPlist({
      label: 'com.example.test',
      command: ['/bin/x'],
      workingDirectory: '/',
      stdoutPath: '/tmp/o',
      stderrPath: '/tmp/e',
      throttleSeconds: 30,
    });
    expect(xml).toContain('<string>com.example.test</string>');
    expect(xml).toContain('<integer>30</integer>');
  });

  test('omits EnvironmentVariables block when env is empty', () => {
    const xml = renderLaunchdPlist({
      command: ['/bin/x'],
      workingDirectory: '/',
      stdoutPath: '/tmp/o',
      stderrPath: '/tmp/e',
    });
    expect(xml).not.toContain('EnvironmentVariables');
  });

  test('emits EnvironmentVariables with sorted entries when env is provided', () => {
    const xml = renderLaunchdPlist({
      command: ['/bin/x'],
      workingDirectory: '/',
      stdoutPath: '/tmp/o',
      stderrPath: '/tmp/e',
      env: { HOME: '/Users/x', PATH: '/usr/local/bin:/usr/bin' },
    });
    expect(xml).toContain('<key>EnvironmentVariables</key>');
    expect(xml).toContain('<key>HOME</key>');
    expect(xml).toContain('<string>/Users/x</string>');
    expect(xml).toContain('<key>PATH</key>');
    expect(xml).toContain('<string>/usr/local/bin:/usr/bin</string>');
  });

  test('determinism: same inputs produce byte-identical output', () => {
    const opts = {
      command: ['/usr/local/bin/monad', 'nexus', 'run'],
      workingDirectory: '/Users/x',
      stdoutPath: '/Users/x/.monad/nexus/logs/nexus-stdout.log',
      stderrPath: '/Users/x/.monad/nexus/logs/nexus-stderr.log',
    };
    expect(renderLaunchdPlist(opts)).toBe(renderLaunchdPlist(opts));
  });
});

describe('resolveLaunchdEnvironment · derives target paths', () => {
  test('uses the requested platform + uid for the launchctl targets', () => {
    const env = resolveLaunchdEnvironment({
      platformOverride: 'darwin',
      uid: 501,
      plistDir: '/tmp/agents',
      label: 'com.monad.nexus',
    });
    expect(env.platform).toBe('darwin');
    expect(env.uid).toBe(501);
    expect(env.bootstrapTarget).toBe('gui/501');
    expect(env.serviceTarget).toBe('gui/501/com.monad.nexus');
    expect(env.plistPath).toBe('/tmp/agents/com.monad.nexus.plist');
  });
});

describe('installLaunchd · platform guard', () => {
  test('non-darwin → not-supported (no fs side-effects)', async () => {
    let writeCalls = 0;
    const res = await installLaunchd({
      platformOverride: 'linux',
      plistDir,
      writePlist: () => { writeCalls += 1; },
    });
    expect(res.outcome).toBe('not-supported');
    if (res.outcome === 'not-supported') {
      expect(res.reason).toContain('macOS-only');
    }
    expect(writeCalls).toBe(0);
  });
});

describe('installLaunchd · happy path', () => {
  test('writes the plist + invokes launchctl bootstrap (default)', async () => {
    const calls: string[][] = [];
    const stub = makeStubRunCli({
      launchctl: (cmd) => {
        calls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const res = await installLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      command: ['/usr/local/bin/monad', 'nexus', 'run'],
      runCli: stub,
    });
    expect(res.outcome).toBe('installed');
    if (res.outcome !== 'installed') return;
    expect(res.bootstrapped).toBe(true);
    expect(existsSync(res.plistPath)).toBe(true);
    const body = readFileSync(res.plistPath, 'utf-8');
    expect(body).toContain('<string>/usr/local/bin/monad</string>');
    // Should bootout-then-bootstrap (idempotent install).
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual(['launchctl', 'bootout', 'gui/501/com.monad.nexus']);
    expect(calls[1]).toEqual(['launchctl', 'bootstrap', 'gui/501', res.plistPath]);
  });

  test('--no-start writes the plist but skips bootstrap', async () => {
    const calls: string[][] = [];
    const stub = makeStubRunCli({
      launchctl: (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; },
    });
    const res = await installLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      noStart: true,
      runCli: stub,
    });
    expect(res.outcome).toBe('installed');
    if (res.outcome !== 'installed') return;
    expect(res.bootstrapped).toBe(false);
    expect(existsSync(res.plistPath)).toBe(true);
    expect(calls.length).toBe(0);
  });

  test('reports shell-only auxiliary keys by name, use, and count without values or plist entries', async () => {
    const auxiliarySecret = 'auxiliary-secret-must-not-appear';
    const providerSecret = 'provider-secret-must-go-to-the-key-cache-not-the-plist';
    process.env.FIRECRAWL_API_KEY = auxiliarySecret;
    process.env.ELEVENLABS_API_KEY = auxiliarySecret;
    process.env.OPENAI_API_KEY = providerSecret;

    const res = await installLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      noStart: true,
    });

    expect(res.outcome).toBe('installed');
    if (res.outcome !== 'installed') return;
    expect(res.auxiliaryAiEnvNotice).toEqual({
      vars: [
        { name: 'FIRECRAWL_API_KEY', usedBy: 'web-search' },
        { name: 'ELEVENLABS_API_KEY', usedBy: 'voice TTS' },
      ],
    });
    expect(res.auxiliaryAiEnvNotice?.vars).toHaveLength(2);
    const output = renderAuxiliaryAiEnvNotice(res.auxiliaryAiEnvNotice!);
    const rendered = output.join('\n');
    expect(rendered).toContain('2 auxiliary AI keys');
    expect(rendered).toContain('FIRECRAWL_API_KEY (web-search)');
    expect(rendered).toContain('ELEVENLABS_API_KEY (voice TTS)');
    expect(rendered).toContain('not added to the launchd plist, so the daemon cannot access them');
    expect(rendered).toContain('Review each integration’s supported setup');
    expect(rendered).not.toContain('monad config');
    expect(JSON.stringify(res.auxiliaryAiEnvNotice)).not.toContain(auxiliarySecret);
    expect(rendered).not.toContain(auxiliarySecret);
    const plist = readFileSync(res.plistPath, 'utf-8');
    const environmentBlock = plist.match(/<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/)?.[1] ?? '';
    const environmentKeys = [...environmentBlock.matchAll(/<key>([^<]+)<\/key>/g)].map(([, key]) => key);
    // 🆕 2026-09-24 (RFC S1) — provider 키는 plist 가 아니라 키 캐시(600)로. 데몬은 부팅 때 캐시로 env 를 채운다.
    expect(environmentKeys).toEqual(['HOME', 'PATH']);
    expect(plist).not.toContain(providerSecret);
    const cacheFile = joinPath(process.env.MONAD_KEY_CACHE_DIR!, 'openai_api_key');
    expect(readFileSync(cacheFile, 'utf-8').trim()).toBe(providerSecret);
    expect(statSync(cacheFile).mode & 0o777).toBe(0o600);
    expect(res.keyCache).toEqual({ written: ['OPENAI_API_KEY'], differs: [] });
    expect(plist).not.toContain('FIRECRAWL_API_KEY');
    expect(plist).not.toContain('ELEVENLABS_API_KEY');
    expect(plist).not.toContain(auxiliarySecret);
  });

  test('an existing key cache is never overwritten — a differing shell key is reported by name only', async () => {
    const dir = process.env.MONAD_KEY_CACHE_DIR!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(joinPath(dir, 'openai_api_key'), 'cached-value\n');
    process.env.OPENAI_API_KEY = 'shell-value-differs';
    const res = await installLaunchd({ platformOverride: 'darwin', uid: 501, plistDir, noStart: true });
    expect(res.outcome).toBe('installed');
    if (res.outcome !== 'installed') return;
    expect(res.keyCache).toEqual({ written: [], differs: ['OPENAI_API_KEY'] });
    expect(readFileSync(joinPath(dir, 'openai_api_key'), 'utf-8').trim()).toBe('cached-value');
    expect(JSON.stringify(res.keyCache)).not.toContain('shell-value-differs');
  });

  test('is silent when no shell-only auxiliary keys are set', async () => {
    const res = await installLaunchd({ platformOverride: 'darwin', uid: 501, plistDir, noStart: true });

    expect(res.outcome).toBe('installed');
    if (res.outcome !== 'installed') return;
    expect(res.auxiliaryAiEnvNotice).toBeUndefined();
  });

  test('idempotent — second install bootouts the previous unit before bootstrap', async () => {
    const calls: string[][] = [];
    const stub = makeStubRunCli({
      launchctl: (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; },
    });
    const a = await installLaunchd({ platformOverride: 'darwin', uid: 501, plistDir, runCli: stub });
    expect(a.outcome).toBe('installed');
    const b = await installLaunchd({ platformOverride: 'darwin', uid: 501, plistDir, runCli: stub });
    expect(b.outcome).toBe('installed');
    // 4 calls total — 2 per install.
    expect(calls.length).toBe(4);
    expect(calls[0]?.[1]).toBe('bootout');
    expect(calls[2]?.[1]).toBe('bootout');
  });

  test('bootstrap exit non-zero → outcome:error with stderr in reason', async () => {
    const stub = makeStubRunCli({
      launchctl: (cmd) => {
        if (cmd[1] === 'bootout') return { exitCode: 36, stdout: '', stderr: 'Unknown service' };
        return { exitCode: 5, stdout: '', stderr: 'permission denied' };
      },
    });
    const res = await installLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('error');
    if (res.outcome !== 'error') return;
    expect(res.reason).toContain('permission denied');
    expect(res.plistPath).toContain('com.monad.nexus.plist');
  });
});

describe('uninstallLaunchd', () => {
  test('booted out + plist removed → outcome:uninstalled', async () => {
    // Pre-write a plist file.
    await installLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      noStart: true,
      runCli: makeStubRunCli({ launchctl: () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
    });
    const calls: string[][] = [];
    const stub = makeStubRunCli({
      launchctl: (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; },
    });
    const res = await uninstallLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('uninstalled');
    if (res.outcome !== 'uninstalled') return;
    expect(res.bootedOut).toBe(true);
    expect(res.removedFile).toBe(true);
    expect(existsSync(res.plistPath)).toBe(false);
    expect(calls[0]).toEqual(['launchctl', 'bootout', 'gui/501/com.monad.nexus']);
  });

  test('no plist + bootout fails → outcome:not-installed', async () => {
    const stub = makeStubRunCli({
      launchctl: () => ({ exitCode: 36, stdout: '', stderr: 'Unknown service' }),
    });
    const res = await uninstallLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('not-installed');
  });

  test('platform guard — non-darwin returns not-supported', async () => {
    const res = await uninstallLaunchd({
      platformOverride: 'linux',
      plistDir,
    });
    expect(res.outcome).toBe('not-supported');
  });
});

describe('statusLaunchd', () => {
  test('parses launchctl print state=running + pid', async () => {
    const stub = makeStubRunCli({
      launchctl: () => ({
        exitCode: 0,
        stdout: 'state = running\npid = 12345\n',
        stderr: '',
      }),
    });
    const res = await statusLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('running');
    if (res.outcome !== 'running') return;
    expect(res.pid).toBe(12345);
    expect(res.loaded).toBe(true);
  });

  test('non-zero exit → not-loaded', async () => {
    const stub = makeStubRunCli({
      launchctl: () => ({ exitCode: 113, stdout: '', stderr: '' }),
    });
    const res = await statusLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('not-loaded');
  });

  test('loaded but not running → outcome:loaded', async () => {
    const stub = makeStubRunCli({
      launchctl: () => ({
        exitCode: 0,
        stdout: 'state = not running\n',
        stderr: '',
      }),
    });
    const res = await statusLaunchd({
      platformOverride: 'darwin',
      uid: 501,
      plistDir,
      runCli: stub,
    });
    expect(res.outcome).toBe('loaded');
  });

  test('platform guard — non-darwin returns not-supported', async () => {
    const res = await statusLaunchd({
      platformOverride: 'linux',
      plistDir,
    });
    expect(res.outcome).toBe('not-supported');
  });
});
