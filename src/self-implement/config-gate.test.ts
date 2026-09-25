// #25 P3 — runConfigSyntaxGate 테스트. 셸(zsh -n)·JSON·미지형식 skip 커버.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConfigSyntaxGate } from './config-gate.js';

const zshAvailable = spawnSync('zsh', ['--version'], { timeout: 5_000 }).status === 0;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cfg-gate-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function write(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

describe('runConfigSyntaxGate', () => {
  test('유효 JSON → passed·checked', () => {
    const r = runConfigSyntaxGate(write('config.json', '{"a": 1, "b": [2,3]}'));
    expect(r.passed).toBe(true);
    expect(r.checked).toBe(true);
    expect(r.label).toBe('JSON.parse');
  });

  test('깨진 JSON → fail(적용 차단)', () => {
    const r = runConfigSyntaxGate(write('config.json', '{"a": 1,,}'));
    expect(r.passed).toBe(false);
    expect(r.checked).toBe(true);
  });

  test('JSONC 주석 허용 → passed', () => {
    const r = runConfigSyntaxGate(write('settings.jsonc', '{\n  // 주석\n  "a": 1\n}'));
    expect(r.passed).toBe(true);
  });

  test('미지 형식(.md) → skip(passed·checked=false)', () => {
    const r = runConfigSyntaxGate(write('README.md', '# hi\nnonsense {{{'));
    expect(r.passed).toBe(true);
    expect(r.checked).toBe(false);
  });

  test.skipIf(!zshAvailable)('유효 .zshrc → passed(zsh -n)', () => {
    const r = runConfigSyntaxGate(write('.zshrc', 'export PATH="$PATH:/x"\nalias ll="ls -la"\n'));
    expect(r.passed).toBe(true);
    expect(r.label).toBe('zsh -n');
  });

  test.skipIf(!zshAvailable)('깨진 .zshrc(닫히지 않은 if) → fail', () => {
    const r = runConfigSyntaxGate(write('.zshrc', 'if [ -z "$X" ]; then\n  echo hi\n'));  // fi 없음
    expect(r.passed).toBe(false);
    expect(r.checked).toBe(true);
  });
});
