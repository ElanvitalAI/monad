// 미션 CLI 스토어 스코프 가드 — 자기사고(2026-07-14) 회귀 방지.
import { test, expect, describe, afterEach } from 'bun:test';
import { missionCliScopeError, MISSION_MUTATING_ACTIONS } from './mission-cli-scope-guard.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../monad-config-dir.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

const savedState = process.env.MONAD_STATE_DIR;
afterEach(() => {
  resetMonadConfigDir();
  if (savedState === undefined) delete process.env.MONAD_STATE_DIR;
  else process.env.MONAD_STATE_DIR = savedState;
});

describe('missionCliScopeError', () => {
  test('MONAD_STATE_DIR 미설정 → 통과(운영 디폴트)', () => {
    delete process.env.MONAD_STATE_DIR;
    expect(missionCliScopeError()).toBeNull();
  });

  test('MONAD_STATE_DIR == config-dir → 통과(데몬이 둘 다 맞춘 정합)', () => {
    process.env.MONAD_STATE_DIR = '/repo/.monad-test';
    setMonadConfigDir('/repo/.monad-test');
    expect(missionCliScopeError()).toBeNull();
  });

  test('⚠️ MONAD_STATE_DIR=test 인데 config-dir=운영 → 거부(내가 당한 그 사고)', () => {
    process.env.MONAD_STATE_DIR = '/repo/.monad-test';
    // ⚠️ **운영 config-dir 을 명시한다**(2026-07-27 정정) — 종전엔 *"override 없으면 운영 디폴트"* 에
    //    기댔는데, P3(#5479) 이후 config-dir 은 **state-dir 을 따라오므로** 그 가정으로는 어긋남이
    //    만들어지지 않아 이 테스트가 계속 빨간 채였다. 가드가 죽은 게 아니라 **사고를 재현하려면
    //    두 축을 실제로 어긋나게 줘야 한다**(그게 그 사고의 모양이기도 하다: `--config-dir` 운영 명시).
    setMonadConfigDir(join(homedir(), '.monad'));
    const err = missionCliScopeError();
    expect(err).not.toBeNull();
    expect(err).toContain('스토어 스코프 불일치');
    expect(err).toContain('--config-dir /repo/.monad-test');
  });

  test('mutating 액션 목록 — cancel/approve/arm 포함, 읽기 미포함', () => {
    expect(MISSION_MUTATING_ACTIONS.has('cancel')).toBe(true);
    expect(MISSION_MUTATING_ACTIONS.has('approve')).toBe(true);
    expect(MISSION_MUTATING_ACTIONS.has('arm')).toBe(true);
    expect(MISSION_MUTATING_ACTIONS.has('list')).toBe(false);
    expect(MISSION_MUTATING_ACTIONS.has('trace')).toBe(false);
  });
});
