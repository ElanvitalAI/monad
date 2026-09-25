import { describe, it, expect } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createTask, type Task } from '../task-orchestrator/types.js';
import { createMission, type MissionArc } from '../task-orchestrator/mission.js';
import { runMultiphaseMission } from './mission-multiphase-executor.js';
import type { ArcVerifier } from './mission-arc-verify.js';

const MISSION = 'apm_arc_test';

function addPhase(store: TaskStore, id: string, title: string, deps: string[], status: Task['status']): void {
  const t = createTask(
    { title, surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: title }, dependsOn: deps },
    { id, now: 1000 },
  );
  t.goalSlug = MISSION;
  t.status = status;
  store.saveTask(t);
}

function saveArcMission(store: TaskStore, arcs: MissionArc[]): void {
  const m = createMission({ title: '아크 테스트 미션', source: { kind: 'manual' } }, { id: MISSION, now: 1000 });
  store.saveMission({ ...m, autopilot: { origin: 'manual', arcModel: 'multi', arcs } });
}

const arc = (over: Partial<MissionArc> & { arcId: string }): MissionArc => ({
  name: over.arcId, intent: 'x', phaseIds: [], dependsOnArcs: [], acceptance: [], status: 'pending', ...over,
});

describe('runMultiphaseMission — 아크 배리어 + 통합 검증(A2)', () => {
  it('아크1 통합 검증 통과 → 아크2 실행(배리어 열림) → 전 페이즈 done', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    // 아크1 = p1,p2 · 아크2 = p3(아크1 선행)
    saveArcMission(store, [
      arc({ arcId: 'arc1', name: '관측계약', phaseIds: ['task:p1', 'task:p2'], acceptance: ['통합됨'] }),
      arc({ arcId: 'arc2', name: '집행', phaseIds: ['task:p3'], dependsOnArcs: ['arc1'], acceptance: ['집행됨'] }),
    ]);
    addPhase(store, 'task:p1', '타입', [], 'ready');
    addPhase(store, 'task:p2', '관측', ['task:p1'], 'blocked');
    addPhase(store, 'task:p3', '집행', [], 'ready'); // 페이즈 dep 없지만 아크 배리어로 막힘

    const order: string[] = [];
    const verifyArc: ArcVerifier = async () => ({ ok: true, evidence: '통합 확인' });
    const r = await runMultiphaseMission(MISSION, async (t) => { order.push(t.title); return { ok: true, summary: 'ok' }; }, { store, now: () => 2000, verifyArc });

    expect(r.done).toBe(3);
    expect(r.failed).toBe(0);
    // 아크1(p1,p2) 이 p3 보다 먼저 — 아크 배리어로 p3 는 아크1 검증 후에만.
    expect(order.indexOf('집행')).toBeGreaterThan(order.indexOf('관측'));
    store.close();
  });

  it('아크1 통합 검증 실패 → 아크2 배리어 유지·중단(페이즈는 green 이나 아크로 미충족)', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    saveArcMission(store, [
      arc({ arcId: 'arc1', name: '관측계약', phaseIds: ['task:p1', 'task:p2'], acceptance: ['observe 배선'] }),
      arc({ arcId: 'arc2', name: '집행', phaseIds: ['task:p3'], dependsOnArcs: ['arc1'], acceptance: ['집행됨'] }),
    ]);
    addPhase(store, 'task:p1', '타입', [], 'ready');
    addPhase(store, 'task:p2', '관측', ['task:p1'], 'blocked');
    addPhase(store, 'task:p3', '집행', [], 'ready');

    const order: string[] = [];
    // 아크1 = dead-code(미배선) → 통합 검증 실패
    const verifyArc: ArcVerifier = async (a) => a.arcId === 'arc1'
      ? { ok: false, evidence: '', missing: 'observe 가 export만·미배선(dead-code)' }
      : { ok: true, evidence: 'ok' };
    const r = await runMultiphaseMission(MISSION, async (t) => { order.push(t.title); return { ok: true, summary: 'ok' }; }, { store, now: () => 2000, verifyArc });

    // p1,p2 는 페이즈로는 done(green) 이지만 아크1 통합 검증 실패 → 중단. p3(집행) 미실행.
    expect(order).not.toContain('집행');
    expect(store.getTask('task:p3')!.status).not.toBe('done');
    expect(r.failed).toBeGreaterThanOrEqual(1);
    store.close();
  });

  it('아크 내 독립 페이즈는 병렬 실행(A3) — 동시 실행 관측', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    // 아크1 = p1,p2 (서로 dep 없음·독립) → 병렬 가능. 아크2 = p3(아크1 선행).
    saveArcMission(store, [
      arc({ arcId: 'arc1', name: '병렬아크', phaseIds: ['task:p1', 'task:p2'], acceptance: [] }),
      arc({ arcId: 'arc2', name: '후속', phaseIds: ['task:p3'], dependsOnArcs: ['arc1'], acceptance: [] }),
    ]);
    addPhase(store, 'task:p1', 'A', [], 'ready');
    addPhase(store, 'task:p2', 'B', [], 'ready'); // p1 과 독립(dep 없음)
    addPhase(store, 'task:p3', 'C', [], 'ready'); // 아크2 — 아크 배리어로 대기

    let concurrent = 0;
    let maxConcurrent = 0;
    const r = await runMultiphaseMission(MISSION, async () => {
      concurrent += 1; maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((res) => setTimeout(res, 20));
      concurrent -= 1;
      return { ok: true, summary: 'ok' };
    }, { store, verifyArc: async () => ({ ok: true, evidence: 'ok' }) });

    expect(r.done).toBe(3);
    expect(maxConcurrent).toBeGreaterThanOrEqual(2); // p1,p2 동시 실행됨
    store.close();
  });

  it('병렬도 상한(parallelCap) 준수', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    saveArcMission(store, [arc({ arcId: 'arc1', name: '큰아크', phaseIds: ['task:p1', 'task:p2', 'task:p3'], acceptance: [] })]);
    addPhase(store, 'task:p1', 'A', [], 'ready');
    addPhase(store, 'task:p2', 'B', [], 'ready');
    addPhase(store, 'task:p3', 'C', [], 'ready');
    let concurrent = 0, maxC = 0;
    await runMultiphaseMission(MISSION, async () => {
      concurrent += 1; maxC = Math.max(maxC, concurrent);
      await new Promise((res) => setTimeout(res, 15));
      concurrent -= 1;
      return { ok: true, summary: 'ok' };
    }, { store, parallelCap: 2, verifyArc: async () => ({ ok: true, evidence: 'ok' }) });
    expect(maxC).toBeLessThanOrEqual(2); // cap=2
    store.close();
  });

  it('영속화(A7-L3) — 아크 완료 status 가 스토어에 되쓰인다(in-memory 증발 아님)', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    saveArcMission(store, [arc({ arcId: 'arc1', name: '단일', phaseIds: ['task:p1'], acceptance: ['배선됨'] })]);
    addPhase(store, 'task:p1', 'A', [], 'ready');
    await runMultiphaseMission(MISSION, async () => ({ ok: true, summary: 'ok' }),
      { store, now: () => 2000, verifyArc: async () => ({ ok: true, evidence: '통합 확인' }) });
    // ★ 핵심: 프로세스 종료 후에도 스토어에 done 이 보존(영속화). 이전엔 복사본만 바뀌어 pending 갇힘.
    const persisted = store.getMission(MISSION)!.autopilot!.arcs!.find((a) => a.arcId === 'arc1')!;
    expect(persisted.status).toBe('done');
    expect(persisted.verifyResult?.ok).toBe(true);
    store.close();
  });

  it('시동 reconcile(A7-L3) — 전 페이즈 done인데 status 갇힌 아크를 검증→done·배리어 열림', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    // 레트로 마이그레이션 재현: arc1 페이즈들이 이미 done 인데 arc.status=pending(영속화 부재로 갇힘).
    saveArcMission(store, [
      arc({ arcId: 'arc1', name: '선행', phaseIds: ['task:p1', 'task:p2'], acceptance: ['통합됨'], status: 'pending' }),
      arc({ arcId: 'arc2', name: '후속', phaseIds: ['task:p3'], dependsOnArcs: ['arc1'], acceptance: [] }),
    ]);
    addPhase(store, 'task:p1', 'A', [], 'done');
    addPhase(store, 'task:p2', 'B', [], 'done');
    addPhase(store, 'task:p3', 'C', [], 'ready'); // 아크2 — arc1 이 pending 이면 배리어로 막힘

    const order: string[] = [];
    const r = await runMultiphaseMission(MISSION, async (t) => { order.push(t.title); return { ok: true, summary: 'ok' }; },
      { store, now: () => 2000, verifyArc: async () => ({ ok: true, evidence: '통합 확인' }) });

    // reconcile 이 arc1 을 done 으로(persist) → 배리어 열려 p3(C) 실행.
    expect(store.getMission(MISSION)!.autopilot!.arcs!.find((a) => a.arcId === 'arc1')!.status).toBe('done');
    expect(order).toContain('C');
    expect(r.failed).toBe(0);
    store.close();
  });

  it('자동 descope(2026-07-15) — 전 페이즈 terminal·cancelled 섞임 아크 → descoped·배리어 열림(668871 arc2 선례)', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    // arc1: p1 cancelled(descope) + p2 done → all-terminal 이나 all-done 아님 → 자동 descoped.
    saveArcMission(store, [
      arc({ arcId: 'arc1', name: '임베딩 접근', phaseIds: ['task:p1', 'task:p2'], acceptance: ['통합됨'], status: 'pending' }),
      arc({ arcId: 'arc2', name: '후속', phaseIds: ['task:p3'], dependsOnArcs: ['arc1'], acceptance: [] }),
    ]);
    addPhase(store, 'task:p1', 'A', [], 'cancelled');
    addPhase(store, 'task:p2', 'B', [], 'done');
    addPhase(store, 'task:p3', 'C', [], 'ready');

    const order: string[] = [];
    const arcEvents: string[] = [];
    const r = await runMultiphaseMission(MISSION, async (t) => { order.push(t.title); return { ok: true, summary: 'ok' }; },
      { store, now: () => 2000, verifyArc: async () => ({ ok: true, evidence: 'x' }), onArcResult: (e) => arcEvents.push(`${e.arcId}:${e.status}`) });

    // arc1 → descoped(non-blocking) · 배리어 열려 p3(C) 실행 · 미션 안 갇힘.
    expect(store.getMission(MISSION)!.autopilot!.arcs!.find((a) => a.arcId === 'arc1')!.status).toBe('descoped');
    expect(arcEvents).toContain('arc1:descoped');
    expect(order).toContain('C');
    expect(r.failed).toBe(0);
    store.close();
  });

  it('시동 reconcile 실패(A7-L3) — 전 페이즈 done이나 통합 미충족 → failed persist·후속 배리어 유지·arcFailure', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    saveArcMission(store, [
      arc({ arcId: 'arc1', name: '선행', phaseIds: ['task:p1', 'task:p2'], acceptance: ['배선됨'], status: 'pending' }),
      arc({ arcId: 'arc2', name: '후속', phaseIds: ['task:p3'], dependsOnArcs: ['arc1'], acceptance: [] }),
    ]);
    addPhase(store, 'task:p1', 'A', [], 'done');
    addPhase(store, 'task:p2', 'B', [], 'done');
    addPhase(store, 'task:p3', 'C', [], 'ready');

    const order: string[] = [];
    const verifyArc: ArcVerifier = async (a) => a.arcId === 'arc1'
      ? { ok: false, evidence: '', missing: 'export만·미배선(dead-code)' } : { ok: true, evidence: 'ok' };
    const r = await runMultiphaseMission(MISSION, async (t) => { order.push(t.title); return { ok: true, summary: 'ok' }; },
      { store, now: () => 2000, verifyArc });

    expect(store.getMission(MISSION)!.autopilot!.arcs!.find((a) => a.arcId === 'arc1')!.status).toBe('failed');
    expect(order).not.toContain('C'); // 후속 배리어 유지
    expect(r.arcFailure?.arcId).toBe('arc1');
    store.close();
  });

  it('onArcResult(A7 UX) — 아크 완료/reconcile 시 이벤트 발신', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    // arc1 = 실행 완료(complete) · arc2 = 레트로(전 페이즈 done·reconcile)
    saveArcMission(store, [
      arc({ arcId: 'arc1', name: '실행아크', phaseIds: ['task:p1'], acceptance: ['배선됨'] }),
      arc({ arcId: 'arc2', name: '레트로아크', phaseIds: ['task:p2'], dependsOnArcs: ['arc1'], acceptance: ['정합됨'], status: 'pending' }),
    ]);
    addPhase(store, 'task:p1', 'A', [], 'ready');
    addPhase(store, 'task:p2', 'B', [], 'done'); // 이미 done → reconcile 대상

    const events: string[] = [];
    await runMultiphaseMission(MISSION, async () => ({ ok: true, summary: 'ok' }), {
      store, now: () => 2000,
      verifyArc: async () => ({ ok: true, evidence: '통합 확인' }),
      onArcResult: (e) => events.push(`${e.name}:${e.status}:${e.kind}`),
    });
    // arc2 는 reconcile(전 페이즈 done), arc1 은 complete(실행 후 완료).
    expect(events).toContain('레트로아크:done:reconcile');
    expect(events).toContain('실행아크:done:complete');
    store.close();
  });

  it('unverified ≠ failed(적응형 디깅) — grounding 불충분(grounded:false)이면 arcFailure 아닌 arcUnverified', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    saveArcMission(store, [
      arc({ arcId: 'arc1', name: '선행', phaseIds: ['task:p1', 'task:p2'], acceptance: ['배선됨'], status: 'pending' }),
      arc({ arcId: 'arc2', name: '후속', phaseIds: ['task:p3'], dependsOnArcs: ['arc1'], acceptance: [] }),
    ]);
    addPhase(store, 'task:p1', 'A', [], 'done');
    addPhase(store, 'task:p2', 'B', [], 'done');
    addPhase(store, 'task:p3', 'C', [], 'ready');

    const order: string[] = [];
    // grounding miss 재현 — ok:false 이지만 grounded:false("못 봤다")
    const verifyArc: ArcVerifier = async () => ({ ok: false, evidence: '', missing: '문서만 봄', grounded: false });
    const r = await runMultiphaseMission(MISSION, async (t) => { order.push(t.title); return { ok: true, summary: 'ok' }; },
      { store, now: () => 2000, verifyArc });

    // arcFailure 아님(arc-revise 안 함) · arcUnverified 세팅(HITL 보류) · 후속 배리어 유지
    expect(r.arcFailure).toBeUndefined();
    expect(r.arcUnverified?.arcId).toBe('arc1');
    expect(order).not.toContain('C');
    // 판정 보류 아크는 done/failed 아님(status verifying) — 스토어 영속.
    expect(store.getMission(MISSION)!.autopilot!.arcs!.find((a) => a.arcId === 'arc1')!.status).toBe('verifying');
    store.close();
  });

  it('종결-스킵 dep(descope 셀프힐) — cancelled dep 은 dependent 를 블록하지 않는다', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    // p1 = descope 취소 · p2 는 p1 을 dep 으로 참조(과거 분해 잔재) → p2 는 갇히면 안 됨.
    addPhase(store, 'task:p1', '취소된 페이즈', [], 'cancelled');
    addPhase(store, 'task:p2', '후속', ['task:p1'], 'blocked');
    const order: string[] = [];
    const r = await runMultiphaseMission(MISSION, async (t) => { order.push(t.title); return { ok: true, summary: 'ok' }; }, { store, now: () => 2000 });
    // p1(cancelled) 이 non-blocking → p2 실행됨(deadlock 아님).
    expect(order).toContain('후속');
    expect(store.getTask('task:p2')!.status).toBe('done');
    expect(r.failed).toBe(0);
    store.close();
  });

  it('flat 미션(아크 없음)은 verifyArc 무관하게 현행대로 — 회귀 0', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    // 미션 저장 없음 → getMission null → resolveArcs 암묵 1아크(acceptance 빈)
    addPhase(store, 'task:p1', 'A', [], 'ready');
    addPhase(store, 'task:p2', 'B', ['task:p1'], 'blocked');
    let verifyCalled = false;
    const verifyArc: ArcVerifier = async () => { verifyCalled = true; return { ok: false, evidence: '', missing: 'x' }; };
    const r = await runMultiphaseMission(MISSION, async () => ({ ok: true, summary: 'ok' }), { store, now: () => 2000, verifyArc });

    expect(r.done).toBe(2); // 전부 완주
    expect(r.failed).toBe(0);
    // 암묵 1아크는 acceptance 빈 배열 → verifyArcAcceptance 가 verifier 호출 전 즉시 통과(호출 안 됨)
    expect(verifyCalled).toBe(false);
    store.close();
  });
});

describe('runMultiphaseMission — AA1 힐 자동집행(phase 5·외부 수습 2026-07-16·default-deny 가드)', () => {
  type Rec = { kind: string; actClass: 'harmless' | 'sensitive' | 'unclassified'; idempotent: boolean; grounded: boolean } | null;
  async function runFail(rec: Rec): Promise<{ notes: string[]; executed: string[] }> {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    saveArcMission(store, [arc({ arcId: 'arc1', name: 'a', phaseIds: ['task:x'] })]);
    addPhase(store, 'task:x', 'x', [], 'ready');
    const executed: string[] = [];
    const aa1Heal = { recommend: () => rec, execute: async (_t: Task, k: string) => { executed.push(k); return true; } };
    await runMultiphaseMission(MISSION, async () => ({ ok: false, summary: 'gate-failed' }),
      { store, now: () => 2000, ...(rec !== null ? { aa1Heal } : {}) });
    const notes = store.getTask('task:x')?.notes ?? [];
    store.close();
    return { notes, executed };
  }

  it('무해·멱등·grounded 힐 → 자율 집행(armed=false)·outcome 기록', async () => {
    const { notes, executed } = await runFail({ kind: 'rebuild', actClass: 'harmless', idempotent: true, grounded: true });
    expect(executed).toEqual(['rebuild']);
    expect(notes.some((n) => n.includes('[AA1-HEAL:rebuild]'))).toBe(true);
  });
  it('위험(sensitive) 힐 → HITL(집행 안 함·위험 우선)', async () => {
    const { notes, executed } = await runFail({ kind: 'reboot', actClass: 'sensitive', idempotent: false, grounded: true });
    expect(executed).toEqual([]);
    expect(notes.some((n) => n.includes('[AA1-HITL'))).toBe(true);
  });
  it('grounding 부족 힐 → HITL(근거 부족은 자동 안 함)', async () => {
    const { notes, executed } = await runFail({ kind: 'rebuild', actClass: 'harmless', idempotent: true, grounded: false });
    expect(executed).toEqual([]);
    expect(notes.some((n) => n.includes('[AA1-HITL'))).toBe(true);
  });
  it('비멱등 무해 힐 → HITL(멱등 아니면 자동 안 함)', async () => {
    const { executed } = await runFail({ kind: 'split', actClass: 'harmless', idempotent: false, grounded: true });
    expect(executed).toEqual([]);
  });
  it('seam 미주입 → no-op(회귀 0·기존 실패 동작 불변)', async () => {
    const { notes, executed } = await runFail(null);
    expect(executed).toEqual([]);
    expect(notes.some((n) => n.includes('AA1'))).toBe(false);
  });
});
