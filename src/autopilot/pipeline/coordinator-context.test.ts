// 조율자 → walker 하향 컨텍스트 C5 — 순수 조립기 검증 (2026-07-19)
import { test, expect, describe } from 'bun:test';
import { formatCoordinatorContextForWalker } from './coordinator-context.js';
import type { MissionState } from './mission-state-channels.js';

const phase = (id: string, status: string) => ({ id, title: `p-${id}`, status, kind: 'subagent', dependsOn: [] });
const progress = (o: Record<string, unknown> = {}) => ({ satisfied: false, progressBeingMade: true, inLoop: false, stalled: false, stallCount: 0, recommendation: 'continue', rationale: '진행 중', ...o });

describe('C5 — formatCoordinatorContextForWalker(2층 하향주입)', () => {
  test('progress + phases + failures → 전체 시야 블록', () => {
    const state: MissionState = {
      phases: [phase('a', 'done'), phase('b', 'done'), phase('c', 'ready'), phase('d', 'ready')],
      progress: progress({ rationale: '진행 중(done 2/4)' }),
      failures: [{ phaseId: 'x', title: '시세검증' }],
    };
    const r = formatCoordinatorContextForWalker(state, 'c');
    expect(r.blockText).toContain('[미션 진행 상황 · 조율자 시야]');
    expect(r.blockText).toContain('진행: 2/4 페이즈 done · 이 페이즈=3번째'); // 내 위치
    expect(r.blockText).toContain('상태: 전진 중(stall=0)');
    expect(r.blockText).toContain('권장: continue — 진행 중(done 2/4)');
    expect(r.blockText).toContain('⚠ 실패 페이즈(1): 시세검증');
    // 관측 지표
    expect(r.donePhases).toBe(2); expect(r.totalPhases).toBe(4); expect(r.failureCount).toBe(1);
    expect(r.recommendation).toBe('continue');
  });

  test('교착(inLoop)·충족 상태 반영', () => {
    const loop = formatCoordinatorContextForWalker({ phases: [phase('a', 'ready')], progress: progress({ inLoop: true, stallCount: 3 }) }, 'a');
    expect(loop.blockText).toContain('stall=3·교착');
    const sat = formatCoordinatorContextForWalker({ phases: [phase('a', 'done')], progress: progress({ satisfied: true, recommendation: 'done' }) }, 'a');
    expect(sat.blockText).toContain('상태: 충족');
  });

  test('실패 상위 3개만', () => {
    const fails = Array.from({ length: 5 }, (_, i) => ({ phaseId: `f${i}`, title: `실패${i}` }));
    const r = formatCoordinatorContextForWalker({ phases: [phase('a', 'ready')], failures: fails }, 'a');
    expect(r.blockText).toContain('⚠ 실패 페이즈(5): 실패0 · 실패1 · 실패2');
    expect(r.blockText).not.toContain('실패3');
  });

  test('phases 만(progress 없음) → 진행률만', () => {
    const r = formatCoordinatorContextForWalker({ phases: [phase('a', 'done'), phase('b', 'ready')] }, 'b');
    expect(r.blockText).toContain('진행: 1/2 페이즈 done · 이 페이즈=2번째');
    expect(r.blockText).not.toContain('권장');
  });

  test('정보 없으면(phases·progress 부재) 무주입', () => {
    const r = formatCoordinatorContextForWalker({}, 'a');
    expect(r.blockText).toBe('');
  });

  test('내 페이즈가 목록에 없으면 위치 생략(무주입 아님)', () => {
    const r = formatCoordinatorContextForWalker({ phases: [phase('a', 'done')] }, 'zzz');
    expect(r.blockText).toContain('진행: 1/1 페이즈 done');
    expect(r.blockText).not.toContain('이 페이즈=');
  });
});
