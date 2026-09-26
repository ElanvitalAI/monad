// #25 P2 — 그림자 스테이징 + 실위치 적용 테스트. stageNonGitDir(비-git dir → git repo 그림자) +
// applyShadowToTarget(백업 필수 → rsync 미러링). 안전 불변식: 백업 없으면 적용 안 함·삭제 반영.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { stageNonGitDir, applyShadowToTarget, stageFile, applyFileToTarget } from './shadow-stage.js';

function git(cwd: string, ...argv: string[]) {
  return spawnSync('git', argv, { cwd, encoding: 'utf8', timeout: 20_000 });
}
const rsyncAvailable = spawnSync('rsync', ['--version'], { timeout: 5_000 }).status === 0;

let target: string;
const shadows: string[] = [];

beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), 'shadow-target-'));
  writeFileSync(join(target, 'a.txt'), 'original-a\n');
  writeFileSync(join(target, 'keep.txt'), 'keep\n');
  mkdirSync(join(target, 'sub'));
  writeFileSync(join(target, 'sub', 'b.txt'), 'original-b\n');
});
afterEach(() => {
  rmSync(target, { recursive: true, force: true });
  // 백업 형제(<target>.bak-*) 정리.
  for (const f of readdirSync(dirname(target))) {
    if (f.startsWith(`${basename(target)}.bak-`)) rmSync(join(dirname(target), f), { recursive: true, force: true });
  }
  for (const s of shadows.splice(0)) rmSync(s, { recursive: true, force: true });
});

describe('stageNonGitDir', () => {
  test('비-git dir → git repo 그림자(내용 복사 + 베이스라인 커밋 + 브랜치)', () => {
    const s = stageNonGitDir({ target, branch: 'dev/x' });
    shadows.push(s.path);
    expect(existsSync(join(s.path, '.git'))).toBe(true);
    expect(readFileSync(join(s.path, 'a.txt'), 'utf8')).toBe('original-a\n');
    expect(readFileSync(join(s.path, 'sub', 'b.txt'), 'utf8')).toBe('original-b\n');
    // 베이스라인 커밋됨 → 워킹트리 clean.
    expect(git(s.path, 'status', '--porcelain').stdout.trim()).toBe('');
    // 편집 브랜치 체크아웃됨.
    expect(git(s.path, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()).toBe('dev/x');
    expect(s.branch).toBe('dev/x');
  });

  test('그림자 편집이 diff 를 남김(goal-loop 산출 파리티)', () => {
    const s = stageNonGitDir({ target, branch: 'dev/y' });
    shadows.push(s.path);
    writeFileSync(join(s.path, 'a.txt'), 'edited-a\n');       // 변경
    writeFileSync(join(s.path, 'new.txt'), 'new-file\n');     // 신규
    expect(git(s.path, 'status', '--porcelain').stdout.trim()).not.toBe('');
  });

  test('디렉토리 아님/없음 → throw', () => {
    expect(() => stageNonGitDir({ target: join(target, 'a.txt'), branch: 'b' })).toThrow();
    expect(() => stageNonGitDir({ target: join(target, 'nope'), branch: 'b' })).toThrow();
  });

  test('cleanup → 그림자 제거', () => {
    const s = stageNonGitDir({ target, branch: 'dev/z' });
    expect(existsSync(s.path)).toBe(true);
    s.cleanup();
    expect(existsSync(s.path)).toBe(false);
  });
});

describe('applyShadowToTarget', () => {
  test.skipIf(!rsyncAvailable)('★ 백업 생성 + 그림자 변경을 실위치에 미러링(변경·신규·삭제)', () => {
    const s = stageNonGitDir({ target, branch: 'dev/apply' });
    shadows.push(s.path);
    // 그림자에서 편집: a 수정 · new 추가 · keep 삭제.
    writeFileSync(join(s.path, 'a.txt'), 'edited-a\n');
    writeFileSync(join(s.path, 'new.txt'), 'brand-new\n');
    rmSync(join(s.path, 'keep.txt'));

    const r = applyShadowToTarget({ shadowPath: s.path, target, stamp: 'test1' });
    expect(r.applied).toBe(true);

    // 백업이 원본을 보존.
    expect(existsSync(r.backup)).toBe(true);
    expect(readFileSync(join(r.backup, 'a.txt'), 'utf8')).toBe('original-a\n');
    expect(readFileSync(join(r.backup, 'keep.txt'), 'utf8')).toBe('keep\n');

    // 실위치가 그림자로 미러링.
    expect(readFileSync(join(target, 'a.txt'), 'utf8')).toBe('edited-a\n');
    expect(readFileSync(join(target, 'new.txt'), 'utf8')).toBe('brand-new\n');
    expect(existsSync(join(target, 'keep.txt'))).toBe(false);          // --delete 반영
    // 그림자 git 메타는 실위치로 새지 않음(--exclude=.git).
    expect(existsSync(join(target, '.git'))).toBe(false);
  });

  test.skipIf(!rsyncAvailable)('런타임 산출물은 제외하고 기존 대상 산출물은 보존하며 사용자 변경은 반영한다', () => {
    const s = stageNonGitDir({ target, branch: 'dev/runtime-artifacts' });
    shadows.push(s.path);
    writeFileSync(join(s.path, 'a.txt'), 'edited-a\n');
    writeFileSync(join(s.path, 'new.txt'), 'brand-new\n');
    rmSync(join(s.path, 'keep.txt'));
    writeFileSync(join(s.path, '.elanous-child-liveness.hb'), 'shadow-heartbeat\n');
    mkdirSync(join(s.path, '.elanous'));
    writeFileSync(join(s.path, '.elanous', 'state.json'), 'shadow-state\n');
    writeFileSync(join(target, '.elanous-child-liveness.hb'), 'target-heartbeat\n');
    mkdirSync(join(target, '.elanous'));
    writeFileSync(join(target, '.elanous', 'state.json'), 'target-state\n');

    const r = applyShadowToTarget({ shadowPath: s.path, target, stamp: 'runtime-artifacts' });

    expect(r.applied).toBe(true);
    expect(readFileSync(join(target, 'a.txt'), 'utf8')).toBe('edited-a\n');
    expect(readFileSync(join(target, 'new.txt'), 'utf8')).toBe('brand-new\n');
    expect(existsSync(join(target, 'keep.txt'))).toBe(false);
    expect(readFileSync(join(target, '.elanous-child-liveness.hb'), 'utf8')).toBe('target-heartbeat\n');
    expect(readFileSync(join(target, '.elanous', 'state.json'), 'utf8')).toBe('target-state\n');
  });

  test('그림자/대상 없음 → throw(적용 전 가드)', () => {
    expect(() => applyShadowToTarget({ shadowPath: join(tmpdir(), 'no-shadow-xyz'), target })).toThrow();
    const s = stageNonGitDir({ target, branch: 'dev/g' });
    shadows.push(s.path);
    expect(() => applyShadowToTarget({ shadowPath: s.path, target: join(tmpdir(), 'no-target-xyz') })).toThrow();
  });

  test.skipIf(!rsyncAvailable)('백업은 항상 먼저 생성된다(적용 성공 시 backup 경로 유효)', () => {
    const s = stageNonGitDir({ target, branch: 'dev/b' });
    shadows.push(s.path);
    const r = applyShadowToTarget({ shadowPath: s.path, target, stamp: 'test2' });
    expect(r.backup).toContain('.bak-test2');
    expect(existsSync(r.backup)).toBe(true);
  });
});

describe('stageFile / applyFileToTarget (#25 P3 · config/dotfile)', () => {
  let file: string;
  beforeEach(() => {
    file = join(target, '.zshrc');
    writeFileSync(file, 'export ORIG=1\n');
  });

  test('단일 파일 → 파일 하나 담은 git repo 그림자(fileName·베이스라인)', () => {
    const s = stageFile({ target: file, branch: 'dev/f' });
    shadows.push(s.path);
    expect(s.fileName).toBe('.zshrc');
    expect(existsSync(join(s.path, '.git'))).toBe(true);
    expect(readFileSync(join(s.path, '.zshrc'), 'utf8')).toBe('export ORIG=1\n');
    expect(git(s.path, 'status', '--porcelain').stdout.trim()).toBe('');  // 커밋됨
    expect(git(s.path, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()).toBe('dev/f');
  });

  test('디렉토리를 stageFile → throw', () => {
    expect(() => stageFile({ target, branch: 'b' })).toThrow();
  });

  test('★ 파일 편집을 실위치에 반영 + 백업(디렉토리 미러링 아님·부모 형제 무접촉)', () => {
    // 대상 부모에 다른 파일이 있어도 파일 단위 apply 는 그것을 건드리지 않는다.
    const sibling = join(target, 'sibling.txt');
    writeFileSync(sibling, 'untouched\n');
    const s = stageFile({ target: file, branch: 'dev/fa' });
    shadows.push(s.path);
    writeFileSync(join(s.path, '.zshrc'), 'export ORIG=2\nalias x=y\n');   // 편집

    const r = applyFileToTarget({ shadowPath: s.path, fileName: s.fileName, target: file, stamp: 'f1' });
    expect(r.applied).toBe(true);
    expect(existsSync(r.backup)).toBe(true);
    expect(readFileSync(r.backup, 'utf8')).toBe('export ORIG=1\n');          // 백업=원본
    expect(readFileSync(file, 'utf8')).toBe('export ORIG=2\nalias x=y\n');    // 실위치 반영
    expect(readFileSync(sibling, 'utf8')).toBe('untouched\n');               // 형제 무접촉(핵심)
  });

  test('그림자 파일/대상 없음 → throw(적용 전 가드)', () => {
    const s = stageFile({ target: file, branch: 'dev/fg' });
    shadows.push(s.path);
    expect(() => applyFileToTarget({ shadowPath: s.path, fileName: 'nope.txt', target: file })).toThrow();
    expect(() => applyFileToTarget({ shadowPath: s.path, fileName: s.fileName, target: join(target, 'no-target') })).toThrow();
  });
});
