// ⛔⭐⭐⭐ **진입점을 바꾸는 변경은 «진입점»으로 검증한다** (CLAUDE.md · 배선 PR 규율).
//   in-process import 는 `bin/monad.mjs → src/index.ts → commander 등록 → registerStandaloneLogSink →
//   runDocsStale` 사슬을 «원리상» 못 탄다. 이 파일만 실물 `spawn` 을 한다.
//   ⚠️ 그래서 «느리다»(git archive 두 번 ⊕ AST 인벤토리 셋). per-test 타임아웃을 «명시»한다 —
//     bun 기본 5초면 타임아웃이 곧 무출력이라 「죽은 경로」와 구분이 안 된다.
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..');
const cli = join(repoRoot, 'bin', 'monad.mjs');

/** 이름 하나가 «있었다가 사라진» 최소 저장소를 만든다 — 이 도구의 판별자를 그대로 재현한다. */
function repoWithRemovedIdentifier(): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-cli-integ-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' });
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'src', 'gone.ts'), 'export const vanishedSymbolForIntegration = 1;\n');
  writeFileSync(join(root, 'docs', 'PLAN-x-2026-01-01.md'), '# x\n\n`vanishedSymbolForIntegration` 를 쓴다.\n');
  git('add', '.');
  git('commit', '-m', 'has the symbol');
  rmSync(join(root, 'src', 'gone.ts'));            // ⭐ 여기서 «사라진다»
  git('add', '-A');
  git('commit', '-m', 'symbol removed');
  return root;
}

describe('monad docs stale — 실물 진입점', () => {
  test('bin/monad.mjs 로 실제 실행해 늙음을 판정하고 exit 0 을 낸다', () => {
    const root = repoWithRemovedIdentifier();
    const stateDir = mkdtempSync(join(tmpdir(), 'docs-cli-state-'));
    try {
      const run = spawnSync('bun', [cli, 'docs', 'stale', 'docs/PLAN-x-2026-01-01.md'], {
        cwd: root,
        encoding: 'utf-8',
        env: { ...process.env, MONAD_STATE_DIR: stateDir, MONAD_CONFIG_DIR: stateDir },
        timeout: 180_000,
      });
      // ⛔ 「0」을 읽기 전에 — 산출이 «나왔나»부터 본다(무출력은 죽은 경로와 구분이 안 된다)
      expect(run.error).toBeUndefined();
      expect(`${run.stdout}${run.stderr}`.length).toBeGreaterThan(0);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('늙음');
      expect(run.stdout).toContain('vanishedSymbolForIntegration');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  }, 240_000);

  test('모르는 --axis 는 exit 2 이고 허용 목록을 stderr 로 낸다 — 조용히 기본으로 안 넘어간다', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'docs-cli-state-'));
    try {
      const run = spawnSync('bun', [cli, 'docs', 'stale', '--axis', 'nope'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        env: { ...process.env, MONAD_STATE_DIR: stateDir, MONAD_CONFIG_DIR: stateDir },
        timeout: 120_000,
      });
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('removed-identifiers');
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  }, 180_000);

  test('⭐ 관측이 «실제» logs.db 에 닿는다 — 주입된 가짜 logger 가 아니라 sink 를 지난다', () => {
    const root = repoWithRemovedIdentifier();
    const stateDir = mkdtempSync(join(tmpdir(), 'docs-cli-state-'));
    try {
      // ⛔⭐⭐⭐ **`NODE_ENV` 를 «벗긴다»** — 이 자식은 유닛 테스트가 아니라 «진짜 CLI 호출»이다.
      //   📍 `src/mss/logging/log-store.ts:433`  if (process.env.NODE_ENV === 'test') return null;
      //   `bun test` 가 `NODE_ENV=test` 를 세팅하고 `...process.env` 로 자식이 그것을 «상속»한다
      //   ⇒ sink 가 «설계대로» 꺼져서 로그가 한 줄도 안 남는다.
      //   📏 2026-08-12 실측: 이 한 줄이 없으면 자식이 exit 0 · 산출 정상인데 state-dir 이 «통째로 빈다».
      //   ⚠️ 그러므로 「테스트에서 로그가 0건」은 «결함이 아닐 수» 있다 — 먼저 이 게이트를 본다(`MEAS-T65`).
      const env = { ...process.env, MONAD_STATE_DIR: stateDir, MONAD_CONFIG_DIR: stateDir, NODE_ENV: 'production' };
      const run = spawnSync('bun', [cli, 'docs', 'stale', 'docs/PLAN-x-2026-01-01.md'], {
        cwd: root, encoding: 'utf-8', env, timeout: 180_000,
      });
      expect(run.status).toBe(0);
      // ⛔ «내부 경로 배치»가 아니라 «1급 조회로 읽히나»가 계약이다.
      const read = spawnSync('bun', [cli, 'logs', '--exact-category', 'docs.stale', '--limit', '5', '--json'], {
        cwd: root, encoding: 'utf-8', env, timeout: 120_000,
      });
      expect(read.status).toBe(0);
      expect(read.stdout).toContain('assessment-result');
      expect(read.stdout).toContain('removed-identifiers');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  }, 300_000);
});
