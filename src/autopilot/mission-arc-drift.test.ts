import { test, expect, describe } from 'bun:test';
import {
  detectArcSizeDrift, buildArcDriftRecommendation, summarizeArcDrift, ARC_SPLIT_DRIFT_THRESHOLD,
} from './mission-arc-drift.js';
import type { MissionArc } from '../task-orchestrator/mission.js';

const arc = (over: Partial<MissionArc> & { arcId: string }): MissionArc => ({
  name: over.arcId, intent: 'x', phaseIds: [], dependsOnArcs: [], acceptance: [], status: 'pending', ...over,
});

describe('mission-arc-drift — 아크 크기 drift 자기감지(§5·split 2회)', () => {
  test('임계=2 — split 1회는 미발화, 2회는 발화', () => {
    expect(ARC_SPLIT_DRIFT_THRESHOLD).toBe(2);
    const arcs = [arc({ arcId: 'a', splitCount: 1 }), arc({ arcId: 'b', splitCount: 2, phaseIds: ['p1', 'p2'] })];
    const d = detectArcSizeDrift(arcs);
    expect(d.map((x) => x.arcId)).toEqual(['b']);
    expect(d[0]!.splitCount).toBe(2);
  });

  test('splitCount 미기록(undefined)=0 — 미발화', () => {
    expect(detectArcSizeDrift([arc({ arcId: 'a' })])).toHaveLength(0);
  });

  test('descoped/done 아크는 제외(이미 해소)', () => {
    const arcs = [
      arc({ arcId: 'a', splitCount: 3, status: 'descoped' }),
      arc({ arcId: 'b', splitCount: 3, status: 'done' }),
      arc({ arcId: 'c', splitCount: 3, status: 'active' }),
    ];
    expect(detectArcSizeDrift(arcs).map((x) => x.arcId)).toEqual(['c']);
  });

  test('권장 문안 — 4페이즈 이상은 카빙/성숙도, 미만은 후속 분리', () => {
    const big = buildArcDriftRecommendation({ arcId: 'a', name: '관측', splitCount: 2, phaseCount: 5 });
    expect(big).toContain('카빙');
    expect(big).toContain('HITL');
    const small = buildArcDriftRecommendation({ arcId: 'a', name: '관측', splitCount: 2, phaseCount: 2 });
    expect(small).toContain('새 아크로 분리');
  });

  test('summarizeArcDrift — 첫 drift 요약 or null', () => {
    expect(summarizeArcDrift([arc({ arcId: 'a', splitCount: 2 })])).toContain('크기 오판');
    expect(summarizeArcDrift([arc({ arcId: 'a', splitCount: 0 })])).toBeNull();
  });

  test('커스텀 임계', () => {
    expect(detectArcSizeDrift([arc({ arcId: 'a', splitCount: 1 })], 1)).toHaveLength(1);
  });
});
