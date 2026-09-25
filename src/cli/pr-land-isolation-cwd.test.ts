// 🩸 2026-09-25 — `pr land` 의 격리 게이트가 «착지하는 트리»가 아니라 bin 이 있는 트리(pilot)를 검사했다.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPrLandIsolationGate } from './pr-cli.js';

function repo(withHardcode: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'iso-gate-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'isolation-hardcode-baseline.txt'), '');
  writeFileSync(join(dir, 'src', 'a.ts'), withHardcode
    ? "import { homedir } from 'node:os';\nimport { join } from 'node:path';\nexport const p = join(homedir(), '.monad', 'auth.json');\n"
    : "export const p = 1;\n");
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const quiet = { log: () => {}, error: () => {} };

test('the gate judges the tree being landed (cwd), not the tree the CLI binary lives in', () => {
  expect(runPrLandIsolationGate(quiet, repo(true))).toBe(false);
  expect(runPrLandIsolationGate(quiet, repo(false))).toBe(true);
});

test('a subdirectory resolves to the repository top level', () => {
  const dir = repo(true);
  expect(runPrLandIsolationGate(quiet, join(dir, 'src'))).toBe(false);
});
