// `elanous python where|check|setup` — RFC-doctor-fix-build-toolchain-and-python-by-distro A4·A5 (P3).
// setup 은 doctor --fix 와 같은 계약: 기본 = 계획만 · --yes 로 적용 · 되돌리기 = venv 폴더 삭제.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  REPO_ROOT, declaredPythonVersion, evaluatePythonEnv, elanousVenvDir, parseRequirements, probePython, resolvePython, venvBasePython, venvNeedsRecreation,
  type PythonEnvCheck,
} from '../python/resolve-python.js';
import { debug } from '../debug/log.js';
import { detectDistroFamily, remediesFor } from './doctor-distro.js';

function venvRemedy(): string | undefined {
  try {
    const osRelease = process.platform === 'linux' && existsSync('/etc/os-release') ? readFileSync('/etc/os-release', 'utf8') : null;
    return remediesFor(detectDistroFamily(process.platform, osRelease))?.pythonVenv;
  } catch { return undefined; }
}

type Out = { log: (s: string) => void; error: (s: string) => void };

export function requirementFiles(extra: boolean, root = REPO_ROOT): string[] {
  return [join(root, 'requirements-python.txt'), ...(extra ? [join(root, 'requirements-python-extra.txt')] : [])];
}

function modulesOf(files: readonly string[]): string[] {
  return files.flatMap((f) => { try { return parseRequirements(readFileSync(f, 'utf8')).map((r) => r.module); } catch { return []; } });
}

export function checkPythonEnv(extra = false): PythonEnvCheck {
  const files = requirementFiles(extra);
  const declarationsFound = existsSync(files[0]!);
  const resolution = resolvePython();
  const probe = resolution ? probePython(resolution.path, modulesOf(files)) : null;
  const venvExists = existsSync(process.platform === 'win32' ? win32.join(elanousVenvDir(), 'Scripts', 'python.exe') : join(elanousVenvDir(), 'bin', 'python'));
  // venv 가 없거나 pip 없는 venv 면 «기반» 파이썬이 venv⊕pip 를 만들 수 있나를 잰다(Ubuntu: python3-venv 없으면 못 만든다).
  let baseHasEnsurepip: boolean | undefined;
  if (!venvExists || probe?.hasPip === false) {
    const base = venvBasePython();
    baseHasEnsurepip = base ? probePython(base.path, []).hasEnsurepip : undefined;
  }
  const remedy = venvRemedy();
  return evaluatePythonEnv({ resolution, declared: declaredPythonVersion(), probe, venvExists, declarationsFound, platform: process.platform, ...(baseHasEnsurepip !== undefined ? { baseHasEnsurepip } : {}), ...(remedy ? { venvRemedy: remedy } : {}) });
}

export function runPythonWhere(out: Out = console, json = false, pathOnly = false): number {
  const r = resolvePython();
  if (pathOnly) { if (r) out.log(r.path); return r ? 0 : 1; }
  if (json) out.log(JSON.stringify({ resolution: r, declared: declaredPythonVersion(), venv: elanousVenvDir() }));
  else out.log(r ? `${r.path}  (${r.source})` : 'none');
  return r ? 0 : 1;
}

export function runPythonCheck(opts: { extra?: boolean; json?: boolean } = {}, out: Out = console): number {
  const c = checkPythonEnv(opts.extra ?? false);
  if (opts.json) out.log(JSON.stringify(c));
  else out.log(`python-env: ${c.status} — ${c.evidence}${c.remedy ? ` — ${c.remedy}` : ''}`);
  return c.status === 'ok' ? 0 : c.status === 'fixable' ? 10 : 2;
}

export interface PythonSetupDeps {
  run?: typeof spawnSync;
  out?: Out;
  platform?: NodeJS.Platform;
  base?: ReturnType<typeof venvBasePython>;
  venv?: string;
  exists?: (path: string) => boolean;
  probe?: (python: string, modules: readonly string[]) => ReturnType<typeof probePython>;
  removeVenv?: (path: string) => void;
  check?: (extra: boolean) => PythonEnvCheck;
}

export function runPythonSetup(opts: { yes?: boolean; extra?: boolean } = {}, deps: PythonSetupDeps = {}): number {
  const out = deps.out ?? console;
  const run = deps.run ?? spawnSync;
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? existsSync;
  const probe = deps.probe ?? probePython;
  const base = deps.base === undefined ? venvBasePython() : deps.base;
  const venv = deps.venv ?? elanousVenvDir();
  const files = requirementFiles(opts.extra ?? false);
  if (!base) { out.error('⛔ no base python found — install Python first (see `elanous python check`)'); return 2; }
  if (!exists(files[0]!)) { out.error(`⛔ ${files[0]} not found — this install is missing its python declarations; reinstall elanous`); return 2; }
  const venvPy = platform === 'win32' ? win32.join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');
  // 🩸 09-24 빈 Ubuntu 실측: python3-venv 없이 만든 venv 엔 pip 가 없고, 다음 실행은 «있다»고 보고 건너뛰어 영영 실패했다.
  const existingVenv = exists(venvPy) ? probe(venvPy, []) : null;
  const recreate = existingVenv !== null && venvNeedsRecreation(existingVenv, platform);
  const venvHasPip = existingVenv !== null && !recreate;
  if (recreate) out.log(`  (existing venv has no pip or uses an unsupported Python — it will be recreated)`);
  if (!venvHasPip && probe(base.path, []).hasEnsurepip === false) {
    const remedy = venvRemedy();
    out.error(`⛔ ${base.path} cannot create a venv with pip (ensurepip missing)${remedy ? ` — ${remedy}` : ''}`);
    return 3;
  }
  const steps: Array<[string, string[]]> = [
    ...(venvHasPip ? [] : [[base.path, ['-m', 'venv', '--system-site-packages', venv]] as [string, string[]]]),
    // --prefer-binary: 📏 2026-09-25 amazonlinux:2(glibc 2.26) — 없으면 pip 가 최신판(manylinux_2_28 wheel 만 있음)을 골라
    //   sdist 빌드로 실패(rc=1) · 있으면 호환 wheel 판(numpy 2.2.6 등)으로 9개 전부 설치·import(rc=0).
    [venvPy, ['-m', 'pip', 'install', '-q', '--prefer-binary', ...files.flatMap((f) => ['-r', f])]],
  ];
  out.log(`python setup plan (base ${base.path} · ${base.source}):`);
  for (const [cmd, args] of steps) out.log(`  ${cmd} ${args.join(' ')}`);
  out.log(`  undo: rm -rf ${venv}`);
  if (!opts.yes) { out.log('apply with --yes'); return 0; }
  if (recreate) (deps.removeVenv ?? ((path: string) => rmSync(path, { recursive: true, force: true })))(venv);
  for (const [cmd, args] of steps) {
    const r = run(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'], timeout: 30 * 60_000 });
    if (r.status !== 0) {
      try { debug.log('python.setup', 'failed', { cmd, args, status: r.status }); } catch { /* */ }
      out.error(`⛔ failed: ${cmd} ${args.join(' ')} (exit ${r.status})`);
      return 1;
    }
  }
  const after = (deps.check ?? checkPythonEnv)(opts.extra ?? false);
  try { debug.log('python.setup', 'finished', { status: after.status, evidence: after.evidence, venv, base: base.path }); } catch { /* */ }
  out.log(`python-env: ${after.status} — ${after.evidence}`);
  return after.status === 'ok' ? 0 : 1;
}
