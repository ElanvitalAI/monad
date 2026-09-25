// split 자동재개 seam 검증 — 순서 불변식(race 차단)·무회귀·idempotent·관측 성공실패.
import { test, expect, describe } from 'bun:test';
import { resumeAfterSplit, type SplitResumeDeps } from './mission-split-resume.js';

function makeDeps(over: Partial<SplitResumeDeps> & { spawnOk?: boolean; done?: boolean } = {}): {
  deps: SplitResumeDeps; calls: string[]; observed: string[];
} {
  const calls: string[] = [];
  const observed: string[] = [];
  let done = over.done ?? false;
  const deps: SplitResumeDeps = {
    splitOccurred: over.splitOccurred ?? true,
    alreadyDone: () => done,
    markDone: () => { done = true; calls.push('markDone'); },
    markSkipRelease: () => calls.push('markSkipRelease'),
    releaseLock: () => calls.push('releaseLock'),
    spawnRun: () => { calls.push('spawnRun'); return over.spawnOk ?? true; },
    observe: (e) => observed.push(e),
  };
  return { deps, calls, observed };
}

describe('resumeAfterSplit — split 자동재개 결정(순수 seam)', () => {
  test('split 없으면 무동작(무회귀) — spawn·관측 없음', () => {
    const { deps, calls, observed } = makeDeps({ splitOccurred: false });
    expect(resumeAfterSplit(deps)).toBe(false);
    expect(calls).toEqual([]);
    expect(observed).toEqual([]);
  });

  test('이미 처리(idempotent) → 무동작 — 정상완료+exit 핸들러 중복 spawn 차단', () => {
    const { deps, calls } = makeDeps({ done: true });
    expect(resumeAfterSplit(deps)).toBe(false);
    expect(calls).toEqual([]);
  });

  test('★ 순서 불변식 — markSkipRelease→releaseLock→spawnRun (child 락 보호·acquire 가능)', () => {
    const { deps, calls } = makeDeps();
    expect(resumeAfterSplit(deps)).toBe(true);
    // markDone(idempotent) 후 skip-release 마킹 → 락 해제 → 그 다음에야 spawn(락 해제 후여야 child acquire).
    expect(calls).toEqual(['markDone', 'markSkipRelease', 'releaseLock', 'spawnRun']);
    // releaseLock 이 spawnRun 보다 앞(child 가 락 얻으려면).
    expect(calls.indexOf('releaseLock')).toBeLessThan(calls.indexOf('spawnRun'));
    // markSkipRelease 가 releaseLock 보다 앞(그 사이 exit 핸들러가 child 락 못 지우게).
    expect(calls.indexOf('markSkipRelease')).toBeLessThan(calls.indexOf('releaseLock'));
  });

  test('spawn 성공 → respawn-after-unlock 관측(spawn 후 판정)', () => {
    const { deps, observed } = makeDeps({ spawnOk: true });
    resumeAfterSplit(deps);
    expect(observed).toEqual(['respawn-after-unlock']);
  });

  test('★ spawn 실패 → respawn-failed 관측(정지 탐지·성공 은폐 금지)', () => {
    const { deps, observed } = makeDeps({ spawnOk: false });
    resumeAfterSplit(deps);
    expect(observed).toEqual(['respawn-failed']);
  });

  test('spawnRun 예외 → respawn-failed(예외 은폐 금지·release 는 이미 됨)', () => {
    const calls: string[] = [];
    const observed: string[] = [];
    let done = false;
    const deps: SplitResumeDeps = {
      splitOccurred: true,
      alreadyDone: () => done, markDone: () => { done = true; },
      markSkipRelease: () => calls.push('skip'), releaseLock: () => calls.push('release'),
      spawnRun: () => { throw new Error('spawn boom'); },
      observe: (e) => observed.push(e),
    };
    expect(resumeAfterSplit(deps)).toBe(true);
    expect(calls).toEqual(['skip', 'release']); // 락은 예외 전에 이미 해제됨(정지 방지).
    expect(observed).toEqual(['respawn-failed']);
  });
});
