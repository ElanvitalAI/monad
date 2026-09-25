// 🩸 2026-09-25 amazonlinux:2 — 기본 c++ 는 gcc7(C++20 불가) · gcc10 은 gcc10-g++ 로 따로. «처음 찾은 하나»만 재면 영영 manual 이었다.
import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultProbeBuildToolchain } from './doctor-cli.js';

function fakeBin(dir: string, name: string, rc: number): void {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\ncat >/dev/null\nexit ${rc}\n`);
  chmodSync(p, 0o755);
}

test('a later candidate (gcc10-g++) that accepts gnu++20 makes the toolchain ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cxx-'));
  fakeBin(dir, 'c++', 1);
  fakeBin(dir, 'gcc10-g++', 0);
  fakeBin(dir, 'make', 0);
  const exists = (name: string) => existsSync(join(dir, name));
  expect(defaultProbeBuildToolchain(exists, [dir])).toEqual({ make: true, cxx20: true });
});

test('when every candidate rejects gnu++20 the answer is false (measured, not unknown)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cxx-'));
  fakeBin(dir, 'c++', 1);
  fakeBin(dir, 'g++', 1);
  const exists = (name: string) => existsSync(join(dir, name));
  expect(defaultProbeBuildToolchain(exists, [dir]).cxx20).toBe(false);
});
