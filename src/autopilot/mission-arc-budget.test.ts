import { test, expect, describe } from 'bun:test';
import {
  estimateArcCostUsd, withArcCosts, totalArcBudgetUsd, arcBudgetDeltaUsd, DEFAULT_PHASE_COST_USD,
} from './mission-arc-budget.js';
import type { MissionArc } from '../task-orchestrator/mission.js';

const arc = (id: string, phaseIds: string[], extra: Partial<MissionArc> = {}): MissionArc => ({
  arcId: id, name: id, intent: '', phaseIds, dependsOnArcs: [], acceptance: [], status: 'pending', ...extra,
});

describe('mission-arc-budget — 아크별 예산 자동 산정(B1)', () => {
  test('멤버 페이즈 견적 합', () => {
    const a = arc('arc_x_0', ['p1', 'p2', 'p3']);
    const costs = new Map([['p1', 2], ['p2', 1.5], ['p3', 0.5]]);
    expect(estimateArcCostUsd(a, costs)).toBe(4);
  });

  test('견적 없는 페이즈는 기본값으로 대체(자동·스킬카운트 근사)', () => {
    const a = arc('arc_x_0', ['p1', 'p2']);
    const costs = new Map<string, number | undefined>([['p1', 3]]); // p2 견적 없음
    expect(estimateArcCostUsd(a, costs)).toBe(3 + DEFAULT_PHASE_COST_USD);
  });

  test('음수/NaN 견적은 기본값으로 fail-safe', () => {
    const a = arc('arc_x_0', ['p1', 'p2']);
    const costs = new Map<string, number | undefined>([['p1', -5], ['p2', NaN]]);
    expect(estimateArcCostUsd(a, costs)).toBe(DEFAULT_PHASE_COST_USD * 2);
  });

  test('0 페이즈 아크 = 0', () => {
    expect(estimateArcCostUsd(arc('arc_x_0', []), new Map())).toBe(0);
  });

  test('withArcCosts — 전 아크 estimatedCost 채움', () => {
    const arcs = [arc('a', ['p1']), arc('b', ['p2', 'p3'])];
    const costs = new Map([['p1', 1], ['p2', 2], ['p3', 2]]);
    const out = withArcCosts(arcs, costs);
    expect(out[0]!.estimatedCost).toBe(1);
    expect(out[1]!.estimatedCost).toBe(4);
    // 원본 불변(순수)
    expect(arcs[0]!.estimatedCost).toBeUndefined();
  });

  test('totalArcBudgetUsd — 합(미산정=0)', () => {
    const arcs = [arc('a', [], { estimatedCost: 3 }), arc('b', [], { estimatedCost: 2.5 }), arc('c', [])];
    expect(totalArcBudgetUsd(arcs)).toBe(5.5);
  });

  test('arcBudgetDeltaUsd — 아크 추가 증가분', () => {
    const before = [arc('a', [], { estimatedCost: 3 })];
    const after = [arc('a', [], { estimatedCost: 3 }), arc('b', [], { estimatedCost: 4 })];
    expect(arcBudgetDeltaUsd(before, after)).toBe(4);
  });
});
