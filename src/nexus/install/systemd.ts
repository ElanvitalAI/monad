// NEXUS · systemd --user install (Phase N-5 PR ω)
//
// `monad nexus install --systemd-user`:
//   1. Render unit (INI) with Restart=on-failure + RestartSec=10. Exit 75
//      from PR χ is non-zero → systemd respawns. Exit 0 (cleanExit) →
//      systemd stays put. Same hermes-style handshake as launchd.
//   2. Write to ~/.config/systemd/user/monad-nexus.service (mode 0o644).
//   3. (default) `systemctl --user daemon-reload` + `enable` + `start`.
//      `--no-start` skips enable + start (daemon-reload still runs so the
//      file is parsed and surfaced in `systemctl --user list-unit-files`).
//
// `monad nexus uninstall --systemd-user`:
//   1. `systemctl --user stop` + `disable` (idempotent — non-zero on
//      already-disabled is treated as success).
//   2. Remove the unit file.
//   3. `systemctl --user daemon-reload`.
//
// `monad nexus status --systemd-user` / statusSystemd():
//   - `systemctl --user is-active` + `is-enabled` decide running/loaded/
//     not-loaded outcomes.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join as joinPath } from 'node:path';
import { nexusLogsDir } from '../paths.js';
import { runCli as defaultRunCli, type RunCli } from '../config/secrets/cli-helper.js';
import { debug } from '../../debug/log.js';
import { nexusRunCommand, persistProviderKeysToCache, type KeyCachePersistResult } from './launchd.js';

export const SYSTEMD_UNIT_NAME = 'monad-nexus.service';
export const SYSTEMD_DEFAULT_RESTART_SECONDS = 10;

export interface RenderSystemdUnitOpts {
  /** ExecStart command (joined into a single line — first element must be
   *  an absolute path or an `executable on PATH`). */
  command: string[];
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  restartSeconds?: number;
  env?: Record<string, string>;
  description?: string;
}

export function renderSystemdServiceUnit(opts: RenderSystemdUnitOpts): string {
  const restart = opts.restartSeconds ?? SYSTEMD_DEFAULT_RESTART_SECONDS;
  const description = opts.description ?? 'monad NEXUS — unified TUI shell + supervisor + meta-api';
  const execStart = opts.command.map(shellQuote).join(' ');
  const envEntries = Object.entries(opts.env ?? {});
  const envLines = envEntries.length === 0
    ? ''
    : envEntries.map(([k, v]) => `Environment="${k}=${v.replace(/"/g, '\\"')}"`).join('\n') + '\n';
  return [
    '[Unit]',
    `Description=${description}`,
    'After=default.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${execStart}`,
    `WorkingDirectory=${opts.workingDirectory}`,
    'Restart=on-failure',
    `RestartSec=${restart}`,
    `StandardOutput=append:${opts.stdoutPath}`,
    `StandardError=append:${opts.stderrPath}`,
    envLines.replace(/\n$/, ''),
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].filter((line, idx, arr) => {
    // Drop the empty Environment placeholder when env is empty.
    return !(line === '' && envLines === '' && idx > 0 && arr[idx - 1] === 'StandardError=append:' + opts.stderrPath);
  }).join('\n');
}

function shellQuote(arg: string): string {
  // systemd's ExecStart parser accepts standard shell quoting. Quote when
  // the arg contains whitespace or any of the systemd-special chars.
  if (/[\s"'$\\;]/.test(arg)) {
    return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return arg;
}

export interface SystemdEnvironment {
  platform: NodeJS.Platform;
  unitName: string;
  unitDir: string;
  unitPath: string;
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  command: string[];
}

export interface SystemdOpts {
  platformOverride?: NodeJS.Platform;
  unitName?: string;
  unitDir?: string;
  command?: string[];
  workingDirectory?: string;
  stdoutPath?: string;
  stderrPath?: string;
  restartSeconds?: number;
  env?: Record<string, string>;
  noStart?: boolean;
  runCli?: RunCli;
  writeUnit?: (path: string, body: string) => void;
  /** 로그 폴더 만들기(시험 주입). */
  ensureDir?: (dir: string) => void;
  /** linger 를 켤 계정(시험 주입 · 기본 = 현재 사용자). */
  user?: string;
}

export function resolveSystemdEnvironment(opts: SystemdOpts = {}): SystemdEnvironment {
  const platform = opts.platformOverride ?? process.platform;
  const unitName = opts.unitName ?? SYSTEMD_UNIT_NAME;
  const unitDir = opts.unitDir ?? joinPath(homedir(), '.config', 'systemd', 'user');
  const unitPath = joinPath(unitDir, unitName);
  const command = opts.command ?? defaultCommand();
  const workingDirectory = opts.workingDirectory ?? homedir();
  const stdoutPath = opts.stdoutPath ?? joinPath(nexusLogsDir(), 'nexus-stdout.log');
  const stderrPath = opts.stderrPath ?? joinPath(nexusLogsDir(), 'nexus-stderr.log');
  return {
    platform,
    unitName,
    unitDir,
    unitPath,
    command,
    workingDirectory,
    stdoutPath,
    stderrPath,
  };
}

function defaultCommand(): string[] {
  // 🩸 2026-09-24: 종전 `monad nexus run` — systemd 는 bare 이름을 고정 경로(/usr/bin 등)에서만 찾아
  //    설치본(`~/.local/share/monad/bin`)이나 `~/.bun/bin` 의 monad 를 못 찾는다. launchd 와 같은 명령을 쓴다.
  return nexusRunCommand();
}

export type InstallSystemdOutcome =
  | {
      outcome: 'installed';
      unitPath: string;
      enabled: boolean;
      started: boolean;
      env: SystemdEnvironment;
      /** 셸에만 있던 provider 키를 키 캐시로 옮긴 결과(이름만) — launchd 설치와 같은 계약. */
      keyCache?: KeyCachePersistResult;
      /** `loginctl enable-linger` — 없으면 사용자 서비스는 «로그인해야» 뜬다(재부팅 뒤 데몬이 죽어 있다). */
      linger?: { ok: boolean; detail?: string };
    }
  | { outcome: 'not-supported'; reason: string }
  | { outcome: 'error'; reason: string; unitPath?: string };

export async function installSystemd(opts: SystemdOpts = {}): Promise<InstallSystemdOutcome> {
  const env = resolveSystemdEnvironment(opts);
  if (env.platform !== 'linux') {
    return { outcome: 'not-supported', reason: `systemd-user install is Linux-only (current: ${env.platform})` };
  }
  // ⭐ 2026-09-24 (재시작 최소화 RFC S1b · launchd `#20112` 의 짝) — 유닛은 키를 굽지 않는다. 그 대신 셸에만 있던
  //   provider 키를 키 캐시(600)로 옮겨, 데몬 부팅의 `hydrateEnvFromKeyCache` 가 읽게 한다. 명시 env 를 준 호출은 건드리지 않는다.
  const keyCache = opts.env ? undefined : persistProviderKeysToCache();

  const unitBody = renderSystemdServiceUnit({
    command: env.command,
    workingDirectory: env.workingDirectory,
    stdoutPath: env.stdoutPath,
    stderrPath: env.stderrPath,
    ...(opts.restartSeconds !== undefined ? { restartSeconds: opts.restartSeconds } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  });

  const writeUnit = opts.writeUnit ?? defaultWriteUnit;
  try {
    // 🩸 2026-09-24 빈 Ubuntu VM 실측: 유닛의 `StandardOutput=append:<~/.monad/nexus/logs/…>` 폴더가 없으면
    //    systemd 가 출력 파일을 못 열어 `status=209/STDOUT` 으로 즉시 죽고 재시작만 반복했다(데몬이 «한 번도» 못 뜬다).
    const ensureDir = opts.ensureDir ?? ((dir: string) => mkdirSync(dir, { recursive: true }));
    for (const dir of new Set([dirname(env.stdoutPath), dirname(env.stderrPath)])) ensureDir(dir);
    writeUnit(env.unitPath, unitBody);
    if (debug.enabled) {
      debug.log('nexus.install.systemd.write', env.unitPath, { unit: env.unitName });
    }
  } catch (err) {
    return { outcome: 'error', reason: `failed to write unit: ${(err as Error).message}`, unitPath: env.unitPath };
  }

  const cli = opts.runCli ?? defaultRunCli;
  // daemon-reload is always run so the new file shows up in
  // `list-unit-files` even when --no-start is requested.
  const reload = await cli(['systemctl', '--user', 'daemon-reload']);
  if (reload.exitCode !== 0) {
    return {
      outcome: 'error',
      reason: `systemctl daemon-reload exit ${reload.exitCode}: ${reload.stderr.trim() || reload.stdout.trim()}`,
      unitPath: env.unitPath,
    };
  }

  if (opts.noStart) {
    return { outcome: 'installed', unitPath: env.unitPath, enabled: false, started: false, env, ...(keyCache ? { keyCache } : {}) };
  }

  const enable = await cli(['systemctl', '--user', 'enable', env.unitName]);
  if (enable.exitCode !== 0) {
    return {
      outcome: 'error',
      reason: `systemctl enable exit ${enable.exitCode}: ${enable.stderr.trim() || enable.stdout.trim()}`,
      unitPath: env.unitPath,
    };
  }
  const start = await cli(['systemctl', '--user', 'start', env.unitName]);
  if (start.exitCode !== 0) {
    return {
      outcome: 'error',
      reason: `systemctl start exit ${start.exitCode}: ${start.stderr.trim() || start.stdout.trim()}`,
      unitPath: env.unitPath,
    };
  }
  // 🩸 2026-09-24 빈 GCP Ubuntu 24.04 실측: Linger=no 면 재부팅 뒤 데몬이 «로그인할 때» 떴다(서버면 영영 안 뜬다).
  //    `loginctl enable-linger $USER` → 부팅 19초 뒤 로그인 없이 기동 · 자기 계정은 sudo 없이 됐다(rc 0). 실패해도 설치는 성공으로 두고 알린다.
  const user = opts.user ?? userInfo().username;
  const lingerRun = await cli(['loginctl', 'enable-linger', user]).catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: String(error) }));
  const linger = lingerRun.exitCode === 0
    ? { ok: true }
    : { ok: false, detail: `loginctl enable-linger ${user} exit ${lingerRun.exitCode}: ${(lingerRun.stderr || lingerRun.stdout).trim()} — run: sudo loginctl enable-linger ${user}` };
  return { outcome: 'installed', unitPath: env.unitPath, enabled: true, started: true, env, linger, ...(keyCache ? { keyCache } : {}) };
}

export type UninstallSystemdOutcome =
  | {
      outcome: 'uninstalled';
      unitPath: string;
      stopped: boolean;
      disabled: boolean;
      removedFile: boolean;
    }
  | { outcome: 'not-supported'; reason: string }
  | { outcome: 'not-installed'; unitPath: string }
  | { outcome: 'error'; reason: string; unitPath?: string };

export async function uninstallSystemd(opts: SystemdOpts = {}): Promise<UninstallSystemdOutcome> {
  const env = resolveSystemdEnvironment(opts);
  if (env.platform !== 'linux') {
    return { outcome: 'not-supported', reason: `systemd-user install is Linux-only (current: ${env.platform})` };
  }

  const cli = opts.runCli ?? defaultRunCli;
  const stop = await cli(['systemctl', '--user', 'stop', env.unitName]).catch(() => ({
    exitCode: 1, stdout: '', stderr: '',
  }));
  const disable = await cli(['systemctl', '--user', 'disable', env.unitName]).catch(() => ({
    exitCode: 1, stdout: '', stderr: '',
  }));

  let removedFile = false;
  if (existsSync(env.unitPath)) {
    try {
      unlinkSync(env.unitPath);
      removedFile = true;
    } catch (err) {
      return { outcome: 'error', reason: `failed to remove unit: ${(err as Error).message}`, unitPath: env.unitPath };
    }
  } else if (stop.exitCode !== 0 && disable.exitCode !== 0) {
    return { outcome: 'not-installed', unitPath: env.unitPath };
  }

  // Reload after removal so list-unit-files reflects the change.
  await cli(['systemctl', '--user', 'daemon-reload']).catch(() => undefined);

  return {
    outcome: 'uninstalled',
    unitPath: env.unitPath,
    stopped: stop.exitCode === 0,
    disabled: disable.exitCode === 0,
    removedFile,
  };
}

export type StatusSystemdOutcome =
  | { outcome: 'running'; unitPath: string; enabled: boolean }
  | { outcome: 'loaded'; unitPath: string; enabled: boolean }
  | { outcome: 'not-loaded'; unitPath: string }
  | { outcome: 'not-supported'; reason: string };

export async function statusSystemd(opts: SystemdOpts = {}): Promise<StatusSystemdOutcome> {
  const env = resolveSystemdEnvironment(opts);
  if (env.platform !== 'linux') {
    return { outcome: 'not-supported', reason: `systemd-user install is Linux-only (current: ${env.platform})` };
  }

  const cli = opts.runCli ?? defaultRunCli;
  const isActive = await cli(['systemctl', '--user', 'is-active', env.unitName]);
  const isEnabled = await cli(['systemctl', '--user', 'is-enabled', env.unitName]);
  const enabled = isEnabled.exitCode === 0 && /^enabled\b/m.test(isEnabled.stdout.trim());
  if (isActive.exitCode === 0 && /^active\b/m.test(isActive.stdout.trim())) {
    return { outcome: 'running', unitPath: env.unitPath, enabled };
  }
  if (existsSync(env.unitPath)) {
    return { outcome: 'loaded', unitPath: env.unitPath, enabled };
  }
  return { outcome: 'not-loaded', unitPath: env.unitPath };
}

function defaultWriteUnit(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o644 });
}
