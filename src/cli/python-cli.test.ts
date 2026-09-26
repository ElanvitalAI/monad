import { expect, test } from 'bun:test';
import { runPythonSetup, type PythonSetupDeps } from './python-cli.js';
import { evaluatePythonEnv } from '../python/resolve-python.js';

test('python setup rebuilds an existing 3.10 Windows venv with the uv 3.12 base and installs requirements', () => {
  const venv = 'C:\\Users\\u\\.local\\share\\elanous\\python\\venv';
  const venvPy = `${venv}\\Scripts\\python.exe`;
  const uv = 'C:\\Users\\u\\AppData\\Roaming\\uv\\python\\cpython-3.12-windows-x86_64-none\\python.exe';
  const actions: string[] = [];
  let version: [number, number, number] = [3, 10, 14];
  const deps: PythonSetupDeps = {
    platform: 'win32', venv, base: { path: uv, source: 'managed' },
    out: { log: (_: string) => {}, error: (_: string) => {} },
    exists: (path: string) => path === venvPy || path.endsWith('requirements-python.txt'),
    probe: (path: string) => path === venvPy
      ? { version, missing: [], hasPip: true }
      : { version: [3, 12, 0], missing: [], hasEnsurepip: true },
    removeVenv: (path: string) => { actions.push(`remove:${path}`); },
    run: ((command: string, args: string[]) => {
      actions.push(`${command}:${args.slice(0, 3).join(' ')}`);
      if (command === uv) version = [3, 12, 0];
      return { status: 0 };
    }) as typeof import('node:child_process').spawnSync,
    check: () => evaluatePythonEnv({ platform: 'win32', resolution: { path: venvPy, source: 'elanous-venv' },
      declared: null, probe: { version, missing: [], hasPip: true }, venvExists: true }),
  };
  expect(runPythonSetup({}, deps)).toBe(0);
  expect(actions).toEqual([]);
  expect(runPythonSetup({ yes: true }, deps)).toBe(0);
  expect(actions[0]).toBe(`remove:${venv}`);
  expect(actions[1]).toBe(`${uv}:-m venv --system-site-packages`);
  expect(actions[2]).toBe(`${venvPy}:-m pip install`);
  expect(version).toEqual([3, 12, 0]);
});
