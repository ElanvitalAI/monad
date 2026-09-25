import { test, expect, describe } from 'bun:test';
import {
  classifyTransientExecutionFailure,
  isTransientExecutionFailure,
} from './execution-transient.js';

// 📏 북극성 런 run-ecd7cf73 조각 ③의 «실물» 에러(logs.db 원문).
const REAL_LOCK_RACE =
  "git worktree base sync failed — origin/main exists but fetch failed: From https://github.com/ElanvitalAI/northstar-113\n"
  + " * branch            main       -> FETCH_HEAD\n"
  + "error: cannot lock ref 'refs/remotes/origin/main': is at c33b79d993931760bf209954030d4bddab2";

describe('isTransientExecutionFailure — 실행 축의 「다시 걸면 풀리나」', () => {
  test('북극성 조각 ③의 실물 락 경합은 참', () => {
    expect(isTransientExecutionFailure(REAL_LOCK_RACE, 'SELF_IMPL_FAILED')).toBe(true);
  });

  test('⭐ LLM 축이 «모른다»고 답하는 순수 락 경합도 참 — 이 모듈이 존재하는 이유', () => {
    // 📏 classifyError 단독으로는 'unknown' → abort 였다(2026-08-19 실측).
    //   ③이 그 자에게 retry 로 잡힌 것은 메시지에 우연히 `fetch failed` 가 섞였기 때문이다.
    expect(isTransientExecutionFailure("fatal: Unable to create '/r/.git/index.lock': File exists.")).toBe(true);
    expect(isTransientExecutionFailure('Another git process seems to be running in this repository')).toBe(true);
  });

  test('영구 결손은 거짓 — 무한 재실행을 만들지 않는다', () => {
    expect(isTransientExecutionFailure('TypeError: cannot read property foo of undefined')).toBe(false);
    expect(isTransientExecutionFailure('tsc: 12 errors')).toBe(false);
    expect(isTransientExecutionFailure('')).toBe(false);
  });

  test('⛔ 쿼터·레이트리밋은 거짓 — 다시 걸어도 같다(조각 재실행은 «십분 단위» 비용)', () => {
    expect(isTransientExecutionFailure('quota exceeded for this account')).toBe(false);
    expect(isTransientExecutionFailure('rate limit reached, too many requests')).toBe(false);
  });

  test('⛔ 상류 실패(DEP_FAILED)는 여기 칸이 아니다 — blocked-upstream 으로 간다', () => {
    expect(isTransientExecutionFailure('dependency task:abc failed', 'DEP_FAILED')).toBe(false);
  });

  test('LLM 축이 아는 네트워크 실패는 그 판정을 그대로 쓴다(재발명 0)', () => {
    expect(isTransientExecutionFailure('socket hang up')).toBe(true);
    expect(isTransientExecutionFailure('ECONNRESET')).toBe(true);
  });

  test('관측값은 실물 락 경합의 참 판정과 기존 boolean 결과를 함께 남긴다', () => {
    const observation = classifyTransientExecutionFailure(REAL_LOCK_RACE, 'SELF_IMPL_FAILED');

    expect(observation).toEqual({ transient: true });
    expect(isTransientExecutionFailure(REAL_LOCK_RACE, 'SELF_IMPL_FAILED')).toBe(observation.transient);
  });

  test('관측값은 영구 결손의 거짓 판정과 기존 boolean 결과를 함께 남긴다', () => {
    const message = 'TypeError: cannot read property foo of undefined';
    const observation = classifyTransientExecutionFailure(message);

    expect(observation).toEqual({ transient: false });
    expect(isTransientExecutionFailure(message)).toBe(observation.transient);
  });
});
