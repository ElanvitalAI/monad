import { describe, it, expect } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createTask } from '../task-orchestrator/types.js';
import { createMission, type MissionArc } from '../task-orchestrator/mission.js';
import { insertArcIntoMission, reorderArcInMission, insertPhaseIntoMission, deletePhaseFromMission, deleteArcFromMission } from './mission-lifecycle.js';

const MISSION = 'apm_arc_edit_test';

function setup(): TaskStore {
  const store = new TaskStore({ path: ':memory:', noWal: true });
  const phaseIds = ['task:aaaa0001', 'task:bbbb0002', 'task:cccc0003', 'task:dddd0004'];
  phaseIds.forEach((id, i) => {
    const t = createTask(
      { title: `phase ${i + 1}`, surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 'x' }, dependsOn: [] },
      { id, now: 1000 + i },
    );
    t.goalSlug = MISSION;
    t.estimateUsd = 1;
    store.saveTask(t);
  });
  const arcs: MissionArc[] = [
    { arcId: 'arc_obs_0', name: '관측', intent: 'x', phaseIds: phaseIds.slice(0, 3), dependsOnArcs: [], acceptance: [], status: 'pending' },
    { arcId: 'arc_exec_1', name: '집행', intent: 'x', phaseIds: [phaseIds[3]!], dependsOnArcs: ['arc_obs_0'], acceptance: [], status: 'pending' },
  ];
  const m = createMission({ title: '아크 편집 테스트', source: { kind: 'manual' } }, { id: MISSION, now: 1000 });
  store.saveMission({ ...m, autopilot: { origin: 'manual', arcModel: 'multi', arcs } });
  return store;
}

describe('insertArcIntoMission (E2) — store 생애주기', () => {
  it('A1 뒤 새 아크 삽입 + 페이즈 카빙 + 배리어 재배선', () => {
    const store = setup();
    const r = insertArcIntoMission(MISSION, { afterArc: 'A1', name: '리서치', phaseHandles: ['2', '3'], store });
    expect(r.ok).toBe(true);
    expect(r.movedPhases).toBe(2);
    const arcs = store.getMission(MISSION)!.autopilot!.arcs!;
    expect(arcs.map((a) => a.name)).toEqual(['관측', '리서치', '집행']); // 위치
    // 관측 아크는 p1 만 남고, 리서치가 p2·p3 를 가짐
    expect(arcs[0]!.phaseIds).toEqual(['task:aaaa0001']);
    expect(arcs[1]!.phaseIds).toEqual(['task:bbbb0002', 'task:cccc0003']);
    // 배리어: 리서치.dependsOn=[관측] · 집행.dependsOn 은 관측→리서치 재배선
    expect(arcs[1]!.dependsOnArcs).toEqual(['arc_obs_0']);
    expect(arcs[2]!.dependsOnArcs).toEqual([arcs[1]!.arcId]);
  });

  it('예산 재산정 — 페이즈 이동은 총예산 보존(델타 0)·아크별 채워짐', () => {
    const store = setup();
    const r = insertArcIntoMission(MISSION, { afterArc: 'A1', name: '리서치', phaseHandles: ['2', '3'], store });
    expect(r.budgetDelta).toBe(0); // 카빙은 비용 추가 아님
    expect(r.totalBudget).toBe(4); // 4 페이즈 × $1
    const arcs = store.getMission(MISSION)!.autopilot!.arcs!;
    expect(arcs[1]!.estimatedCost).toBe(2); // 리서치 = p2+p3
  });

  it('--phases 없으면 거부(vacuous-done 방지)', () => {
    const store = setup();
    const r = insertArcIntoMission(MISSION, { afterArc: 'A1', name: 'x', phaseHandles: [], store });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('phases');
  });

  it('--after 앵커 못 찾으면 거부', () => {
    const store = setup();
    const r = insertArcIntoMission(MISSION, { afterArc: 'A9', name: 'x', phaseHandles: ['1'], store });
    expect(r.ok).toBe(false);
  });
});

describe('reorderArcInMission (E3) — store 생애주기', () => {
  it('아크 위치 이동(핸들 순번)·의존 불변', () => {
    const store = setup();
    const r = reorderArcInMission(MISSION, { arcRef: 'A2', newIdx: 0, store });
    expect(r.ok).toBe(true);
    expect(r.order).toEqual(['arc_exec_1', 'arc_obs_0']);
  });

  it('flat/단일 아크는 재배치 불가', () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    const m = createMission({ title: 'flat', source: { kind: 'manual' } }, { id: 'apm_flat', now: 1000 });
    store.saveMission({ ...m, autopilot: { origin: 'manual' } });
    const r = reorderArcInMission('apm_flat', { arcRef: 'A1', newIdx: 0, store });
    expect(r.ok).toBe(false);
  });
});

describe('insertPhaseIntoMission (E1) — 페이즈 중간 삽입', () => {
  it('앵커 뒤 삽입 + 후속 dependsOn 재배선 + 아크 편입', () => {
    const store = setup();
    // p1(관측) 뒤에 새 페이즈 삽입. p2 는 원래 p1 의존 아니지만(setup deps=[]) 아크 편입 확인.
    const r = insertPhaseIntoMission(MISSION, { afterHandle: '1', title: '새 조사 페이즈', store });
    expect(r.ok).toBe(true);
    const arcs = store.getMission(MISSION)!.autopilot!.arcs!;
    // 관측 아크(p1,p2,p3)에 새 페이즈가 p1 뒤로 편입 → 4개
    expect(arcs[0]!.phaseIds.length).toBe(4);
    expect(arcs[0]!.phaseIds[1]).toBe(r.phaseId!);
    // 새 페이즈는 앵커 의존
    const np = store.listTasks({ goalSlug: MISSION }).find((t) => t.id === r.phaseId)!;
    expect(np.dependsOn).toEqual(['task:aaaa0001']);
    expect(np.status).toBe('backlog');
  });

  it('앵커 못 찾으면 거부', () => {
    const store = setup();
    expect(insertPhaseIntoMission(MISSION, { afterHandle: 'zzz', title: 'x', store }).ok).toBe(false);
  });
});

describe('deletePhaseFromMission (E4) — 페이즈 진짜 삭제', () => {
  it('backlog 페이즈 삭제 + 아크에서 제거', () => {
    const store = setup();
    const r = deletePhaseFromMission(MISSION, '2', { store }); // p2 삭제
    expect(r.ok).toBe(true);
    expect(store.listTasks({ goalSlug: MISSION }).find((t) => t.id === 'task:bbbb0002')).toBeUndefined();
    const arcs = store.getMission(MISSION)!.autopilot!.arcs!;
    expect(arcs[0]!.phaseIds).not.toContain('task:bbbb0002');
  });

  it('done 페이즈는 삭제 거부(skip 유도)', () => {
    const store = setup();
    const p = store.listTasks({ goalSlug: MISSION }).find((t) => t.id === 'task:aaaa0001')!;
    store.saveTask({ ...p, status: 'done' });
    const r = deletePhaseFromMission(MISSION, '1', { store });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('skip');
  });
});

describe('deleteArcFromMission (E4) — 아크 삭제', () => {
  it('전 페이즈 backlog 아크 삭제 + 배리어 재배선', () => {
    const store = setup(); // 관측(A1·backlog), 집행(A2·backlog·dependsOn 관측)
    const r = deleteArcFromMission(MISSION, 'A1', { store });
    expect(r.ok).toBe(true);
    expect(r.deletedPhases).toBe(3);
    const arcs = store.getMission(MISSION)!.autopilot!.arcs!;
    expect(arcs.map((a) => a.arcId)).toEqual(['arc_exec_1']);
    // 집행 아크는 관측 의존이 사라져 선행 상속(관측은 선행 없음 → 빈 deps)
    expect(arcs[0]!.dependsOnArcs).toEqual([]);
  });

  it('진행분 있으면 삭제 거부(descope 유도)', () => {
    const store = setup();
    const p = store.listTasks({ goalSlug: MISSION }).find((t) => t.id === 'task:aaaa0001')!;
    store.saveTask({ ...p, status: 'done' });
    const r = deleteArcFromMission(MISSION, 'A1', { store });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('descoped');
  });

  it('아크 참조 — 이름으로도 지칭 가능(카드에 이름 노출·라이브 도그푸드 교훈)', () => {
    const store = setup();
    const r = deleteArcFromMission(MISSION, '집행', { store }); // arcId=arc_exec_1·name=집행
    expect(r.ok).toBe(true);
    expect(r.deletedArcId).toBe('arc_exec_1');
  });
});
