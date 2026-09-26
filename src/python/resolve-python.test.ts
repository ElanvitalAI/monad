import { describe, expect, test } from 'bun:test';
import { declaredPythonVersion, evaluatePythonEnv, elanousVenvDir, parseRequirements, probePython, resolvePython, venvBasePython, venvNeedsRecreation, versionAtLeast, windowsPythonRemedy } from './resolve-python.js';

const home = '/home/u';
const venvPy = '/home/u/.local/share/elanous/python/venv/bin/python';
const pyenvPy = '/home/u/.pyenv/versions/3.12.12/bin/python3';

describe('resolvePython — order ELANOUS_PYTHON > elanous venv > pyenv > PATH', () => {
  const all = new Set(['/opt/py', venvPy, pyenvPy, '/usr/bin/python3']);
  const exists = (p: string) => all.has(p);
  const base = { home, exists, declared: '3.12.12' as string | null };
  test('each layer wins over the next', () => {
    expect(resolvePython({ ...base, env: { ELANOUS_PYTHON: '/opt/py', PATH: '/usr/bin' } })).toEqual({ path: '/opt/py', source: 'env' });
    expect(resolvePython({ ...base, env: { PATH: '/usr/bin' } })).toEqual({ path: venvPy, source: 'elanous-venv' });
    expect(resolvePython({ ...base, env: { PATH: '/usr/bin' }, exists: (p) => p !== venvPy && exists(p) })).toEqual({ path: pyenvPy, source: 'pyenv' });
    expect(resolvePython({ ...base, declared: null, env: { PATH: '/usr/bin' }, exists: (p) => p === '/usr/bin/python3' })).toEqual({ path: '/usr/bin/python3', source: 'path' });
    expect(resolvePython({ ...base, env: { PATH: '' }, exists: () => false })).toBeNull();
  });
  test('XDG_DATA_HOME moves the venv; the venv base never resolves to the venv itself', () => {
    expect(elanousVenvDir({ XDG_DATA_HOME: '/x' }, home)).toBe('/x/elanous/python/venv');
    expect(venvBasePython({ ...base, env: { PATH: '/usr/bin' } })).toEqual({ path: pyenvPy, source: 'pyenv' });
  });
});

describe('Windows python discovery', () => {
  const uv = 'C:\\Users\\u\\AppData\\Roaming\\uv\\python\\cpython-3.12-windows-x86_64-none\\python.exe';
  const stub = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe';
  test('ignores the WindowsApps stub and uses uv python find at the supported floor', () => {
    const calls: string[] = [];
    const result = resolvePython({ platform: 'win32', env: { PATH: 'C:\\Windows;C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps' }, declared: null,
      exists: (p) => p === stub || p === uv, runUv: (floor) => { calls.push(floor); return { status: 0, stdout: `${uv}\n` }; },
      probeUv: (python) => { expect(python).toBe(uv); return { version: [3, 12, 0], missing: [] }; } });
    expect(result).toEqual({ path: uv, source: 'managed' });
    expect(result?.path).not.toBe(stub);
    expect(calls).toEqual(['>=3.11']);
  });
  test('an old PATH python does not mask a supported uv python; without uv the install remedy can change the selection', () => {
    const old = 'C:\\Python310\\python.exe';
    const calls: string[] = [];
    const deps = { platform: 'win32' as const, declared: null, env: { PATH: 'C:\\Python310' },
      exists: (p: string) => p === old || p === uv,
      probePath: (python: string) => { expect(python).toBe(old); return { version: [3, 10, 14] as [number, number, number], missing: [] }; },
      probeUv: (python: string) => { expect(python).toBe(uv); return { version: [3, 12, 0] as [number, number, number], missing: [] }; } };
    expect(resolvePython({ ...deps, runUv: (floor) => { calls.push(floor); return { status: 0, stdout: uv }; } }))
      .toEqual({ path: uv, source: 'managed' });
    expect(calls).toEqual(['>=3.11']);
    let uvInstalled = false;
    const afterInstall = { ...deps, exists: (p: string) => p === old || (uvInstalled && p === uv),
      runUv: () => ({ status: uvInstalled ? 0 : 1, stdout: uvInstalled ? uv : '' }) };
    expect(resolvePython(afterInstall)).toBeNull();
    expect(evaluatePythonEnv({ platform: 'win32', resolution: null, declared: null, probe: null, venvExists: false }).remedy)
      .toBe('uv python install 3.12');
    uvInstalled = true;
    expect(resolvePython(afterInstall)).toEqual({ path: uv, source: 'managed' });
  });
  test('uv result below the supported floor is rejected even if uv returned success', () => {
    expect(resolvePython({ platform: 'win32', declared: null, env: { PATH: '' }, exists: (p) => p === uv,
      runUv: () => ({ status: 0, stdout: uv }), probeUv: () => ({ version: [3, 10, 14], missing: [] }) })).toBeNull();
  });
  test('an existing 3.10 venv needs rebuilding after uv installs 3.12, not just installing uv', () => {
    const windowsHome = 'C:\\Users\\u';
    const venv = 'C:\\Users\\u\\.local\\share\\elanous\\python\\venv\\Scripts\\python.exe';
    const oldProbe = { version: [3, 10, 14] as [number, number, number], missing: [], hasPip: true };
    const deps = { platform: 'win32' as const, home: windowsHome, declared: null, env: { PATH: '' },
      exists: (p: string) => p === venv || p === uv,
      runUv: () => ({ status: 0, stdout: uv }), probeUv: () => ({ version: [3, 12, 0] as [number, number, number], missing: [] }) };
    expect(resolvePython(deps)).toEqual({ path: venv, source: 'elanous-venv' });
    expect(venvBasePython(deps)).toEqual({ path: uv, source: 'managed' });
    expect(evaluatePythonEnv({ platform: 'win32', resolution: { path: venv, source: 'elanous-venv' }, declared: null, probe: oldProbe, venvExists: true }))
      .toMatchObject({ status: 'manual', remedy: 'uv python install 3.12; if ($LASTEXITCODE -eq 0) { elanous python setup --yes }' });
    expect(venvNeedsRecreation(oldProbe, 'win32')).toBe(true);
    expect(evaluatePythonEnv({ platform: 'win32', resolution: { path: venv, source: 'elanous-venv' }, declared: null,
      probe: { version: null, missing: [], hasPip: false }, venvExists: true }).remedy)
      .toBe('uv python install 3.12; if ($LASTEXITCODE -eq 0) { elanous python setup --yes }');
    expect(venvNeedsRecreation(oldProbe, 'darwin')).toBe(false);
    expect(venvNeedsRecreation({ version: [3, 12, 0], missing: [], hasPip: true }, 'win32')).toBe(false);
    expect(resolvePython({ ...deps, exists: (p) => p === uv })).toEqual({ path: uv, source: 'managed' });
    const rebuilt = { version: [3, 12, 0] as [number, number, number], missing: [], hasPip: true };
    expect(resolvePython(deps)).toEqual({ path: venv, source: 'elanous-venv' });
    expect(venvNeedsRecreation(rebuilt, 'win32')).toBe(false);
    expect(evaluatePythonEnv({ platform: 'win32', resolution: { path: venv, source: 'elanous-venv' }, declared: null, probe: rebuilt, venvExists: true }).status).toBe('ok');
  });
  // Review must-fix (09-25): an explicit ELANOUS_PYTHON on 3.10 keeps winning the resolution order, so "install 3.12"
  // alone repeats the same error. The remedy must re-point (and persist) ELANOUS_PYTHON — keyed by the source.
  test('an explicit ELANOUS_PYTHON below the floor is re-pointed, not just «install 3.12» again', () => {
    const old = 'C:\\Python310\\python.exe';
    const deps = { platform: 'win32' as const, home: 'C:\\Users\\u', declared: null, env: { PATH: '', ELANOUS_PYTHON: old },
      exists: (p: string) => p === old || p === uv,
      runUv: () => ({ status: 0, stdout: uv }), probeUv: () => ({ version: [3, 12, 0] as [number, number, number], missing: [] }) };
    // before: the explicit old interpreter still wins even though uv has 3.12
    expect(resolvePython(deps)).toEqual({ path: old, source: 'env' });
    const before = evaluatePythonEnv({ platform: 'win32', resolution: { path: old, source: 'env' }, declared: null,
      probe: { version: [3, 10, 14], missing: [], hasPip: true }, venvExists: false });
    expect(before.status).toBe('manual');
    expect(before.remedy).toContain("SetEnvironmentVariable('ELANOUS_PYTHON'");
    expect(before.remedy).toContain('uv python find 3.12');
    expect(windowsPythonRemedy('env')).not.toBe(windowsPythonRemedy('path'));
    // after: ELANOUS_PYTHON points at the uv 3.12 interpreter — resolution follows it and the floor passes
    const after = { ...deps, env: { PATH: '', ELANOUS_PYTHON: uv } };
    expect(resolvePython(after)).toEqual({ path: uv, source: 'env' });
    expect(evaluatePythonEnv({ platform: 'win32', resolution: { path: uv, source: 'env' }, declared: null,
      probe: { version: [3, 12, 0], missing: [], hasPip: true }, venvExists: false }).status).not.toBe('manual');
  });
  test('Windows venv wins over PATH and a WindowsApps ELANOUS_PYTHON is ignored', () => {
    const windowsHome = 'C:\\Users\\u';
    const venv = 'C:\\Users\\u\\.local\\share\\elanous\\python\\venv\\Scripts\\python.exe';
    const onPath = 'C:\\Python312\\python.exe';
    const deps = { platform: 'win32' as const, home: windowsHome, declared: null, env: { ELANOUS_PYTHON: stub, PATH: 'C:\\Python312' },
      exists: (p: string) => [stub, venv, onPath].includes(p), probePath: () => ({ version: [3, 12, 0] as [number, number, number], missing: [] }) };
    expect(elanousVenvDir({}, windowsHome)).toBe('C:\\Users\\u\\.local\\share\\elanous\\python\\venv');
    expect(resolvePython(deps)).toEqual({ path: venv, source: 'elanous-venv' });
    expect(venvBasePython(deps)).toEqual({ path: onPath, source: 'path' });
  });
  test('uses a real python.exe on PATH first; missing or old python suggests uv, never pyenv', () => {
    const path = 'C:\\Python312\\python.exe';
    expect(resolvePython({ platform: 'win32', declared: null, env: { PATH: 'C:\\Python312' }, exists: (p) => p === path,
      probePath: () => ({ version: [3, 12, 0], missing: [] }), runUv: () => { throw new Error('should not run'); } }))
      .toEqual({ path, source: 'path' });
    const missing = evaluatePythonEnv({ platform: 'win32', resolution: null, declared: '3.12.12', probe: null, venvExists: false });
    expect(missing).toMatchObject({ status: 'manual', remedy: 'uv python install 3.12' });
    expect(missing.evidence).not.toContain('pyenv');
    expect(evaluatePythonEnv({ platform: 'win32', resolution: { path, source: 'path' }, declared: '3.12.12', probe: { version: [3, 10, 0], missing: [] }, venvExists: false }).remedy)
      .toBe('uv python install 3.12');
  });
});

describe('declarations', () => {
  test('.python-version is read strictly', () => {
    expect(declaredPythonVersion('/r', () => '3.12.12\n')).toBe('3.12.12');
    expect(declaredPythonVersion('/r', () => 'system\n')).toBeNull();
    expect(declaredPythonVersion('/r', () => { throw new Error('no'); })).toBeNull();
  });
  test('requirements map pip names to import names via the comment', () => {
    expect(parseRequirements('# c\npython-dotenv   # import: dotenv  · x\nrequests\nfoo-bar>=1\n')).toEqual([
      { pip: 'python-dotenv', module: 'dotenv' }, { pip: 'requests', module: 'requests' }, { pip: 'foo-bar', module: 'foo_bar' },
    ]);
  });
  test('the repo declarations parse and name only real modules', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(import.meta.dir, '..', '..');
    expect(declaredPythonVersion(root)).toBe('3.12.12');
    const core = parseRequirements(readFileSync(join(root, 'requirements-python.txt'), 'utf8')).map((r) => r.module);
    expect(core).toEqual(['requests', 'dotenv', 'pykrx', 'yfinance', 'pandas', 'numpy']);
  });
});

describe('evaluatePythonEnv', () => {
  const r = { path: pyenvPy, source: 'pyenv' as const };
  test('statuses', () => {
    expect(evaluatePythonEnv({ resolution: null, declared: '3.12.12', probe: null, venvExists: false }).status).toBe('manual');
    expect(evaluatePythonEnv({ resolution: r, declared: '3.12.12', probe: { version: [3, 7, 16], missing: [] }, venvExists: false })).toMatchObject({ status: 'manual', evidence: expect.stringContaining('older than the minimum 3.11'), remedy: expect.stringContaining('pyenv install 3.12.12') });
    // 📏 2026-09-25 debian:12 — 3.11 은 하한을 넘는다(선언 pin 3.12.12 와 무관).
    expect(evaluatePythonEnv({ resolution: r, declared: '3.12.12', probe: { version: [3, 11, 2], missing: [] }, venvExists: false }).status).toBe('fixable');
    expect(evaluatePythonEnv({ resolution: r, declared: '3.12.12', probe: { version: [3, 10, 12], missing: [] }, venvExists: false }).status).toBe('manual');
    expect(evaluatePythonEnv({ resolution: r, declared: '3.12.12', probe: { version: [3, 12, 12], missing: [] }, venvExists: false })).toMatchObject({ status: 'fixable', remedy: 'elanous python setup --yes' });
    expect(evaluatePythonEnv({ resolution: r, declared: '3.12.12', probe: { version: [3, 12, 12], missing: ['pykrx'] }, venvExists: true })).toMatchObject({ status: 'fixable', evidence: expect.stringContaining('pykrx') });
    expect(evaluatePythonEnv({ resolution: r, declared: '3.12.12', probe: { version: [3, 13, 1], missing: [] }, venvExists: true }).status).toBe('ok');
  });
  test('versionAtLeast compares major.minor', () => {
    expect(versionAtLeast([3, 12, 0], '3.12.12')).toBe(true);
    expect(versionAtLeast([3, 9, 25], '3.12')).toBe(false);
    expect(versionAtLeast([4, 0, 0], '3.12')).toBe(true);
  });
});

describe('probePython (real interpreter, when present)', () => {
  test('reports version and missing modules from an actual run', () => {
    const py = resolvePython();
    if (!py) return;
    const p = probePython(py.path, ['json', 'definitely_not_a_module_xyz']);
    expect(p.version?.[0]).toBe(3);
    expect(p.missing).toEqual(['definitely_not_a_module_xyz']);
  });
});

// 셸판(scripts/lib/resolve-python.sh)과 TS판이 «같은 순서»로 푸는지 — 가짜 HOME 으로 대조.
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
describe('shell resolver agrees with the TS resolver', () => {
  test('pyenv layer, then venv layer, then ELANOUS_PYTHON', () => {
    const h = realpathSync(mkdtempSync(join(tmpdir(), 'elanous-py-')));
    try {
      const exe = (p: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, '#!/bin/sh\n'); chmodSync(p, 0o755); };
      const script = join(import.meta.dir, '..', '..', 'scripts', 'lib', 'resolve-python.sh');
      const sh = (env: Record<string, string>) => spawnSync('sh', [script], { encoding: 'utf8', env: { HOME: h, PATH: '/usr/bin:/bin', ...env } }).stdout.trim();
      const ts = (env: Record<string, string>) => resolvePython({ env: { PATH: '/usr/bin:/bin', ...env }, home: h })?.path;
      exe(join(h, '.pyenv/versions/3.12.12/bin/python3'));
      expect(sh({})).toBe(join(h, '.pyenv/versions/3.12.12/bin/python3'));
      expect(ts({})).toBe(sh({}));
      exe(join(h, '.local/share/elanous/python/venv/bin/python'));
      expect(sh({})).toBe(join(h, '.local/share/elanous/python/venv/bin/python'));
      expect(ts({})).toBe(sh({}));
      exe(join(h, 'opt/py'));
      expect(sh({ ELANOUS_PYTHON: join(h, 'opt/py') })).toBe(join(h, 'opt/py'));
      expect(ts({ ELANOUS_PYTHON: join(h, 'opt/py') })).toBe(sh({ ELANOUS_PYTHON: join(h, 'opt/py') }));
    } finally { rmSync(h, { recursive: true, force: true }); }
  });
});

// 🆕 09-24 빈 Ubuntu VM 실측 — 선언 파일 없음(거짓 ok) · pip 없는 venv · ensurepip 없는 기반.
describe('evaluatePythonEnv — fresh-machine cases', () => {
  const r = { path: '/v/bin/python', source: 'elanous-venv' as const };
  const good = { version: [3, 12, 3] as [number, number, number], missing: [] };
  test('missing declarations are manual, never a vacuous ok', () => {
    expect(evaluatePythonEnv({ resolution: r, declared: null, probe: good, venvExists: true, declarationsFound: false }).status).toBe('manual');
  });
  test('a venv without pip is fixable (recreate) when the base can make one', () => {
    expect(evaluatePythonEnv({ resolution: r, declared: '3.12.12', probe: { ...good, hasPip: false }, venvExists: true, baseHasEnsurepip: true }))
      .toMatchObject({ status: 'fixable', evidence: expect.stringContaining('no pip') });
  });
  test('a base without ensurepip is manual with the distro venv line', () => {
    expect(evaluatePythonEnv({ resolution: { path: '/usr/bin/python3', source: 'path' }, declared: '3.12.12', probe: good, venvExists: false, baseHasEnsurepip: false, venvRemedy: 'sudo apt-get install -y python3-venv' }))
      .toMatchObject({ status: 'manual', remedy: 'sudo apt-get install -y python3-venv && elanous python setup --yes' });
  });
});
