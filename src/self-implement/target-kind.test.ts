// #25 P2 — resolveTargetKind 분류 테스트. home 경계는 주입(tmpdir 은 실제 homedir 밖이라
// 주입 없이는 전부 'outside-home' 으로 잡힘). git-repo/non-git-dir/file/missing/outside-home 커버.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTargetKind } from './target-kind.js';

let home: string; // 주입 홈 경계(이 안이 "홈 안").

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tk-home-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('resolveTargetKind', () => {
  test('git repo(.git 존재) → git-repo', () => {
    const repo = join(home, 'repo');
    mkdirSync(repo);
    spawnSync('git', ['init'], { cwd: repo, timeout: 20_000 });
    expect(resolveTargetKind(repo, home)).toBe('git-repo');
  });

  test('git repo 하위 디렉토리 → git-repo(상위 .git 발견)', () => {
    const repo = join(home, 'repo');
    mkdirSync(join(repo, 'sub'), { recursive: true });
    spawnSync('git', ['init'], { cwd: repo, timeout: 20_000 });
    expect(resolveTargetKind(join(repo, 'sub'), home)).toBe('git-repo');
  });

  test('비-git 디렉토리 → non-git-dir', () => {
    const dir = join(home, 'temp');
    mkdirSync(dir);
    expect(resolveTargetKind(dir, home)).toBe('non-git-dir');
  });

  test('단일 파일 → file', () => {
    const file = join(home, '.zshrc');
    writeFileSync(file, 'export X=1\n');
    expect(resolveTargetKind(file, home)).toBe('file');
  });

  test('존재하지 않음 → missing', () => {
    expect(resolveTargetKind(join(home, 'nope'), home)).toBe('missing');
  });

  test('★ homedir 밖 시스템경로 → outside-home(안전벽 최우선·존재/git 불문)', () => {
    // home 밖의 실제 tmp 디렉토리(존재하지만 홈 경계 밖).
    const outside = mkdtempSync(join(tmpdir(), 'tk-outside-'));
    try {
      expect(resolveTargetKind(outside, home)).toBe('outside-home');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('★ 접두 오탐 방지 — `<home>-evil` 은 outside-home(홈 안 아님)', () => {
    const evil = `${home}-evil`;
    mkdirSync(evil);
    try {
      expect(resolveTargetKind(evil, home)).toBe('outside-home');
    } finally {
      rmSync(evil, { recursive: true, force: true });
    }
  });

  test('homedir 자체 → outside-home(홈 루트 편집 거부)', () => {
    expect(resolveTargetKind(home, home)).toBe('outside-home');
  });
});
