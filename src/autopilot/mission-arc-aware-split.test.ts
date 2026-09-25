import { test, expect, describe } from 'bun:test';
import { replaceArcPhase } from './mission-arc.js';
import { splitPhaseIntoSubphases } from './mission-phase-split.js';
import { createMission } from './mission-registry.js';
import { createTask } from '../task-orchestrator/types.js';
import type { MissionArc } from '../task-orchestrator/mission.js';

function arc(id: string, phaseIds: string[], deps: string[] = []): MissionArc {
  return { arcId: id, name: id, intent: id, phaseIds, dependsOnArcs: deps, acceptance: [], status: 'pending' };
}

describe('replaceArcPhase (순수)', () => {
  test('P 를 담은 아크의 phaseIds 에서 P 를 서브페이즈로 치환(같은 위치)', () => {
    const arcs = [arc('a0', ['p0', 'p1', 'P']), arc('a1', ['p2'], ['a0'])];
    const out = replaceArcPhase(arcs, 'P', ['s0', 's1', 's2'])!;
    expect(out[0]!.phaseIds).toEqual(['p0', 'p1', 's0', 's1', 's2']);
    expect(out[1]!.phaseIds).toEqual(['p2']);       // 무관 아크 불변
    expect(out).not.toBe(arcs);                     // 변경 시 새 배열
  });

  test('어느 아크에도 없으면 원본 그대로(flat 회귀 0)', () => {
    const arcs = [arc('a0', ['p0'])];
    expect(replaceArcPhase(arcs, 'NOPE', ['s0'])).toBe(arcs);
    expect(replaceArcPhase(undefined, 'P', ['s0'])).toBeUndefined();
  });
});

async function setup() {
  const { TaskStore } = await import('../task-orchestrator/store.js');
  const store = new TaskStore({ path: ':memory:' });
  const m = createMission(store, { goal: '아크 어웨어 split', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
  const mk = (title: string, dependsOn: string[], now: number) => {
    const t = createTask({
      title, description: title,
      surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: title },
      goalSlug: m.id, dependsOn, status: 'backlog', generatedBy: { kind: 'user', actorId: 'test' },
    }, { allowUncheckedUrgent: true, now });
    store.saveTask(t);
    return t;
  };
  const a = mk('조사', [], 1000);
  const p = mk('관측(과대)', [a.id], 1001);
  // 아크0 = [조사, 관측(과대)] · 아크1 은 아크0 의존
  const raw = store.getMission(m.id)!;
  store.saveMission({ ...raw, autopilot: { ...(raw.autopilot ?? { origin: 'manual' }), arcModel: 'multi',
    arcs: [arc('arc0', [a.id, p.id]), arc('arc1', ['later'], ['arc0'])] } });
  return { store, m, a, p };
}

const SUBS = JSON.stringify({
  rationale: '단일책임 분할',
  tasks: [
    { index: 0, title: '수명주기 스파이크', description: 'x', surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 's0' }, dependsOn: [], priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1, acceptance: { criteria: ['a'] } },
    { index: 1, title: '스냅샷 배선', description: 'x', surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 's1' }, dependsOn: [0], priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1, acceptance: { criteria: ['b'] } },
  ],
});

describe('arc-aware split (통합)', () => {
  test('split 이 아크 소속 페이즈를 서브페이즈로 치환 — dangling 없음·서브페이즈 arc-member', async () => {
    const { store, m, p } = await setup();
    const r = await splitPhaseIntoSubphases(m.id, p.id, {
      store, callable: async () => ({ text: SUBS, modelId: 'mock' }), spawnRun: () => {}, now: () => 5000,
    });
    expect(r.ok).toBe(true);
    expect(r.subTaskIds).toHaveLength(2);
    const arc0 = store.getMission(m.id)!.autopilot!.arcs!.find((a) => a.arcId === 'arc0')!;
    // 원본 p.id 제거(dangling 없음) + 서브페이즈 2개 편입
    expect(arc0.phaseIds).not.toContain(p.id);
    for (const sid of r.subTaskIds) expect(arc0.phaseIds).toContain(sid);
    // 서브페이즈가 실제 태스크 목록에 존재(arc-member 정합)
    const live = new Set(store.listTasks({ goalSlug: m.id }).map((t) => t.id));
    for (const pid of arc0.phaseIds) expect(live.has(pid)).toBe(true);
  });
});
