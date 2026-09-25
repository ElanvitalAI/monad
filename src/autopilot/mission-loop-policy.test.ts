import { describe, it, expect } from 'bun:test';
import {
  resolveGoalLoopMaxIterations,
  OPERATIONAL_GOAL_LOOP_MAX_ITERATIONS_DEFAULT,
  type LoopControlPolicy,
} from './mission-loop-policy.js';

describe('resolveGoalLoopMaxIterations — phaseKind 별 goal-loop 상한(순수)', () => {
  it('operational + config 없음 → 기본 상한(바운디드)', () => {
    expect(resolveGoalLoopMaxIterations('operational', null)).toBe(OPERATIONAL_GOAL_LOOP_MAX_ITERATIONS_DEFAULT);
  });

  it('operational + config 지정 → 그 값', () => {
    const p: LoopControlPolicy = { operational: { maxIterations: 4 } };
    expect(resolveGoalLoopMaxIterations('operational', p)).toBe(4);
  });

  it('operational + config 무효(0/음수) → 기본으로 폴백', () => {
    expect(resolveGoalLoopMaxIterations('operational', { operational: { maxIterations: 0 } })).toBe(OPERATIONAL_GOAL_LOOP_MAX_ITERATIONS_DEFAULT);
    expect(resolveGoalLoopMaxIterations('operational', { operational: { maxIterations: -3 } })).toBe(OPERATIONAL_GOAL_LOOP_MAX_ITERATIONS_DEFAULT);
  });

  it('implementation + config 없음 → undefined(기본 8 유지·회귀0)', () => {
    expect(resolveGoalLoopMaxIterations('implementation', null)).toBeUndefined();
  });

  it('implementation + config 지정 → 그 값(옵트인 상한)', () => {
    expect(resolveGoalLoopMaxIterations('implementation', { implementation: { maxIterations: 12 } })).toBe(12);
  });

  it('미지 phaseKind(undefined) → undefined(보수·기본 유지)', () => {
    expect(resolveGoalLoopMaxIterations(undefined, { operational: { maxIterations: 2 } })).toBeUndefined();
  });

  it('operational 상한이 implementation 보다 타이트해야(조사 재주입 최소 불변식)', () => {
    // config 없을 때: operational=2(바운디드) < implementation=undefined(=기본 8).
    const op = resolveGoalLoopMaxIterations('operational', null)!;
    expect(op).toBeLessThan(8);
  });
});
