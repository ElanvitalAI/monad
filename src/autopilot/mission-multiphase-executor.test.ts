import { describe, it, expect } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createTask, type Task } from '../task-orchestrator/types.js';
import { runMultiphaseMission, parsePhaseVerdict, assessWalkerGrounding, prUrlFromNotes, critiqueFromNotes, hasReviewEscalatedNote, hasReviewPassNote, decideAutonomousAct, decideExecutorControl, resolveExternalCompletionGate, reconcilePostRun, type AutonomousActRequest, type ExecutorControlEvent } from './mission-multiphase-executor.js';

describe('critiqueFromNotes — 완료 리뷰·재반영 대상 판정(대표 2026-07-12)', () => {
  it('[CRITIQUE:verdict] 마커에서 verdict + findings 추출', () => {
    const c = critiqueFromNotes(['[SE-PR] x', '[CRITIQUE:FAIL] 범위밖 apps/pwa/out', '[CRITIQUE:FAIL] 마이그레이션 누락']);
    expect(c.verdict).toBe('FAIL');
    expect(c.findings).toEqual(['범위밖 apps/pwa/out', '마이그레이션 누락']);
  });
  it('지적 없으면 findings 빈 배열(clean)', () => {
    expect(critiqueFromNotes(['[SE-PR] x']).findings).toEqual([]);
  });
});

describe('hasReviewEscalatedNote — R3 자동머지 제외 마커(리뷰 미수렴·HITL)', () => {
  it('[REVIEW:ESCALATED] 노트 감지', () => {
    expect(hasReviewEscalatedNote(['[SE-PR] x', '[REVIEW:ESCALATED] 미배선 반복'])).toBe(true);
  });
  it('마커 없으면 false(clean·자동머지 후보)', () => {
    expect(hasReviewEscalatedNote(['[SE-PR] x', '[CRITIQUE:FAIL] y'])).toBe(false);
    expect(hasReviewEscalatedNote([])).toBe(false);
  });
});

describe('hasReviewPassNote — R3 verdict-gated 자동머지 양성 마커', () => {
  it('[REVIEW:PASS] 감지', () => {
    expect(hasReviewPassNote(['[SE-PR] x', '[REVIEW:PASS]'])).toBe(true);
  });
  it('없으면 false(미검토·fail-soft pass → 자동머지 배제)', () => {
    expect(hasReviewPassNote(['[SE-PR] x'])).toBe(false);
    expect(hasReviewPassNote([])).toBe(false);
  });
});

describe('prUrlFromNotes — 과거 run PR 기억 소실 수정(대표 2026-07-12)', () => {
  it('[SE-PR] 노트에서 PR URL 추출', () => {
    expect(prUrlFromNotes(['[CRITIQUE:x] y', '[SE-PR] https://github.com/o/r/pull/3895']))
      .toBe('https://github.com/o/r/pull/3895');
  });
  it('[SE-PR] 없으면 undefined', () => {
    expect(prUrlFromNotes(['[REBUILD] z'])).toBeUndefined();
  });
});

const MISSION = 'apm_test_multiphase';

function addPhase(store: TaskStore, id: string, title: string, deps: string[], status: Task['status']): void {
  const t = createTask(
    { title, surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: title }, dependsOn: deps },
    { id, now: 1000 },
  );
  t.goalSlug = MISSION;
  t.status = status;
  store.saveTask(t);
}

describe('runMultiphaseMission — dependsOn 순회 집행', () => {
  it('선형 3페이즈를 순서대로 집행하고 모두 done', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    addPhase(store, 'task:p1', '검증', [], 'ready');
    addPhase(store, 'task:p2', '등록', ['task:p1'], 'blocked');
    addPhase(store, 'task:p3', '검토', ['task:p2'], 'blocked');

    const order: string[] = [];
    const r = await runMultiphaseMission(MISSION, async (t) => { order.push(t.title); return { ok: true, summary: 'ok' }; }, { store, now: () => 2000 });

    expect(r.multiphase).toBe(true);
    expect(r.executed).toBe(3);
    expect(r.done).toBe(3);
    expect(r.failed).toBe(0);
    expect(order).toEqual(['검증', '등록', '검토']);
    expect(store.getTask('task:p1')!.status).toBe('done');
    expect(store.getTask('task:p3')!.status).toBe('done');
    store.close();
  });

  it('중간 페이즈 실패 시 중단 — 후속은 blocked 유지', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    addPhase(store, 'task:q1', '검증', [], 'ready');
    addPhase(store, 'task:q2', '등록', ['task:q1'], 'blocked');
    addPhase(store, 'task:q3', '검토', ['task:q2'], 'blocked');

    const r = await runMultiphaseMission(MISSION, async (t) => ({ ok: t.title !== '등록', summary: 'x' }), { store, now: () => 2000 });

    expect(r.executed).toBe(2);
    expect(r.done).toBe(1);
    expect(r.failed).toBe(1);
    // ★ 조기 중단 표현(대표 2026-07-12) — 총 3 중 2 집행·q3 미실행 명시("완료" 오독 방지).
    expect(r.total).toBe(3);
    expect(r.notRun).toEqual(['검토']); // q3 미실행.
    // ★ allPhases(대표 2026-07-12) — 전체 실제 순서·상태(리쥼 리포트/재개 번호 정확).
    expect(r.allPhases?.map((p) => [p.index, p.status])).toEqual([[0, 'done'], [1, 'failed'], [2, 'blocked']]);
    expect(store.getTask('task:q1')!.status).toBe('done');
    expect(store.getTask('task:q2')!.status).toBe('failed');
    expect(store.getTask('task:q3')!.status).toBe('blocked'); // 후속 미실행.
    store.close();
  });

  it('trim 된(존재하지 않는) dep 은 무시하고 진행', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    // p1 이 삭제된 페이즈 task:gone 을 dep 로 갖지만 존재하지 않으므로 게이팅 안 함.
    addPhase(store, 'task:r1', '검증', ['task:gone'], 'ready');
    const r = await runMultiphaseMission(MISSION, async () => ({ ok: true, summary: 'ok' }), { store, now: () => 2000 });
    expect(r.done).toBe(1);
    store.close();
  });

  it('subagent 페이즈가 없으면 multiphase:false (단일턴 폴백)', async () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    const r = await runMultiphaseMission(MISSION, async () => ({ ok: true, summary: '' }), { store, now: () => 2000 });
    expect(r.multiphase).toBe(false);
    store.close();
  });
});

// ★ 조율자 격상 P4 통합 — 실 executor + 실 seam 로직(run-mission 이 배선한 것과 동형)으로 self-heal
//   자동집행이 실 페이즈 실패에서 발동함을 결정론 증명(라이브 미션 실패 유발이 인프라로 불안정해 이걸로
//   확정 검증). GoalBlocker 유형화 → decideAutonomousAct 게이트 → 집행 → AA1-HEAL 흔적 전 경로.
describe('self-heal 자동집행 통합(P4) — 실 executor + aa1Heal seam', () => {
  it('★ 페이즈 실패(예산소진) → GoalBlocker(run_failed·자동힐) → decideAutonomousAct autonomous → 집행 흔적', async () => {
    const { classifyGoalBlocker, goalBlockerToHealRecommend } = await import('./pipeline/goal-blocker.js');
    const store = new TaskStore({ path: ':memory:', noWal: true });
    addPhase(store, 'h1', '조사 페이즈', [], 'ready');
    const healed: Array<{ kind: string }> = [];
    // run-mission 이 배선한 aa1Heal seam 과 동형(recommend=GoalBlocker 분류·execute=비파괴 집행).
    const seam = {
      recommend: (_t: Task, summary: string) => goalBlockerToHealRecommend(classifyGoalBlocker(summary)),
      execute: async (_t: Task, kind: string) => { healed.push({ kind }); return true; },
    };
    const r = await runMultiphaseMission(
      MISSION,
      async () => ({ ok: false, summary: '예산 소진(budget-exhausted) — 조사 미완' }), // 실 실패 시뮬
      { store, now: () => 2000, aa1Heal: seam },
    );
    expect(r.failed).toBe(1);
    // ★ GoalBlocker 가 예산소진을 run_failed(자동힐 harmless)로 분류 → decideAutonomousAct 자율집행 → execute 발동
    expect(healed.length).toBe(1);
    expect(healed[0]!.kind).toBe('retry');
    // 페이즈 notes 에 AA1-HEAL 자율집행 흔적(자기인지)
    const notes = store.listTasks({ goalSlug: MISSION }).find((t) => t.id === 'h1')?.notes ?? [];
    expect(notes.some((n) => n.includes('AA1-HEAL'))).toBe(true);
    store.close();
  });

  it('사용자입력 필요 유형은 HITL 경로(자동집행 안 함)', async () => {
    const { classifyGoalBlocker, goalBlockerToHealRecommend } = await import('./pipeline/goal-blocker.js');
    const store = new TaskStore({ path: ':memory:', noWal: true });
    addPhase(store, 'h2', '구현 페이즈', [], 'ready');
    const healed: string[] = [];
    const seam = {
      recommend: (_t: Task, summary: string) => goalBlockerToHealRecommend(classifyGoalBlocker(summary)),
      execute: async (_t: Task, kind: string) => { healed.push(kind); return true; },
    };
    await runMultiphaseMission(
      MISSION,
      async () => ({ ok: false, summary: '사용자 확정이 필요합니다 — 범위 모호' }),
      { store, now: () => 2000, aa1Heal: seam },
    );
    expect(healed.length).toBe(0); // needs_user_input=sensitive → decideAutonomousAct HITL(자동집행 X)
    const notes = store.listTasks({ goalSlug: MISSION }).find((t) => t.id === 'h2')?.notes ?? [];
    expect(notes.some((n) => n.includes('AA1-HITL'))).toBe(true);
    store.close();
  });
});

describe('parsePhaseVerdict — 성공判定', () => {
  it('마지막 VERDICT 토큰을 판정(대소문자 무관)', () => {
    expect(parsePhaseVerdict('작업 완료.\nVERDICT: PASS')).toBe('pass');
    expect(parsePhaseVerdict('전제 부재로 차단.\nverdict: fail')).toBe('fail');
    // 여러 개면 마지막 것.
    expect(parsePhaseVerdict('중간 VERDICT: PASS\n최종 VERDICT: FAIL')).toBe('fail');
  });

  it('토큰 없으면 null (caller 가 보수적으로 실패 처리)', () => {
    expect(parsePhaseVerdict('그냥 긴 보고서인데 판정 토큰이 없다')).toBeNull();
    expect(parsePhaseVerdict('')).toBeNull();
  });
});

describe('assessWalkerGrounding — walker PASS grounding(Gap C · fake-pass 차단)', () => {
  it('도구 0회 → ungrounded(실제 조사 없이 완료 참칭)', () => {
    expect(assessWalkerGrounding({ toolCalls: 0 }).grounded).toBe(false);
    expect(assessWalkerGrounding({ toolCalls: 0, maxTurns: 24 }).grounded).toBe(false);
  });
  it('maxTurns<2 → ungrounded(도구 결과 합성 턴 구조적 부재)', () => {
    // 도구를 불러도 1턴이면 결과가 다음 턴에 반영 안 됨 → PASS 가 결과에 근거 불가.
    expect(assessWalkerGrounding({ toolCalls: 3, maxTurns: 1 }).grounded).toBe(false);
    expect(assessWalkerGrounding({ toolCalls: 3, maxTurns: 0 }).grounded).toBe(false);
  });
  it('도구 사용 + 합성 턴 확보 → grounded', () => {
    expect(assessWalkerGrounding({ toolCalls: 2, maxTurns: 2 }).grounded).toBe(true);
    expect(assessWalkerGrounding({ toolCalls: 1, maxTurns: 24 }).grounded).toBe(true);
    // maxTurns 미지정(기본 예산·상한 없음) + 도구 사용 → grounded.
    expect(assessWalkerGrounding({ toolCalls: 5 }).grounded).toBe(true);
  });
  it('reason 은 항상 사람이 읽을 수 있는 근거를 준다(관측)', () => {
    expect(assessWalkerGrounding({ toolCalls: 0 }).reason).toContain('조사');
    expect(assessWalkerGrounding({ toolCalls: 3, maxTurns: 1 }).reason).toContain('maxTurns');
  });
});

describe('decideAutonomousAct — 기본거부 자율 ACT 결정(RFC-autonomous-act·외부 수습 2026-07-16)', () => {
  const obs = { missionId: 'apm_x', phaseId: 'p1', source: 'logs.db' };
  const passGuard = { name: 'default-deny', passed: true };
  const req = (o: Partial<AutonomousActRequest>): AutonomousActRequest =>
    ({ actClass: 'harmless', allowlisted: true, observeRef: obs, guard: passGuard, ...o });

  // 표 기반 경계 — [설명, 입력, 기대 mode].
  const cases: Array<[string, Partial<AutonomousActRequest>, 'autonomous' | 'hitl']> = [
    ['명시 무해+allowlist+guard 통과 → autonomous', {}, 'autonomous'],
    ['무해지만 미등재(allowlist X) → 기본거부 HITL', { allowlisted: false }, 'hitl'],
    ['미분류(unclassified) → 기본거부 HITL', { actClass: 'unclassified' }, 'hitl'],
    ['민감(실자금/파괴/arming) → 항상 HITL', { actClass: 'sensitive' }, 'hitl'],
    ['위험·허용 충돌(민감+allowlist) → 위험 우선 HITL', { actClass: 'sensitive', allowlisted: true }, 'hitl'],
    ['guard 미통과 → HITL', { guard: { name: 'budget', passed: false, reason: '예산 소진' } }, 'hitl'],
  ];
  for (const [desc, input, expected] of cases) {
    it(desc, () => { expect(decideAutonomousAct(req(input)).mode).toBe(expected); });
  }

  it('autonomous 결과의 armed 는 항상 false (실무장은 별도 HITL)', () => {
    const d = decideAutonomousAct(req({}));
    expect(d.mode).toBe('autonomous');
    expect(d.armed).toBe(false);
  });

  it('결정성 — 동일 입력은 동일 결과(순수·시각/난수 미의존)', () => {
    const a = decideAutonomousAct(req({}));
    const b = decideAutonomousAct(req({}));
    expect(a).toEqual(b);
  });

  it('OBSERVE·guard·outcome 상관 식별자 보존', () => {
    const d = decideAutonomousAct(req({ outcome: 'done' }));
    expect(d.observeRef).toEqual(obs);
    expect(d.guard).toEqual(passGuard);
    expect(d.outcome).toBe('done');
  });

  it('미분류는 보수적으로 sensitive 로 기록(default-deny 정합)', () => {
    expect(decideAutonomousAct(req({ actClass: 'unclassified' })).actClass).toBe('sensitive');
  });
});

describe('decideExecutorControl — executor 제어 자동대응(AA2/AA3·phase 6·외부 수습 2026-07-16)', () => {
  const ev = (o: Partial<ExecutorControlEvent> & { kind: string }): ExecutorControlEvent =>
    ({ missionId: 'apm_x', ...o });
  const cases: Array<[string, ExecutorControlEvent, 'autonomous' | 'hitl']> = [
    ['AA2 mission-owned start → autonomous', ev({ kind: 'executor-start', owned: true }), 'autonomous'],
    ['AA2 소유권 불명 start → HITL', ev({ kind: 'executor-start', owned: false }), 'hitl'],
    ['AA2 owned idle-stop → autonomous', ev({ kind: 'executor-idle-stop', owned: true }), 'autonomous'],
    ['AA3 멱등 barrier reconcile → autonomous', ev({ kind: 'barrier-reconcile', idempotent: true }), 'autonomous'],
    ['AA3 비멱등 reconcile → HITL', ev({ kind: 'barrier-reconcile', idempotent: false }), 'hitl'],
    ['AA3 멱등 retry(잔여>0) → autonomous', ev({ kind: 'barrier-retry', idempotent: true, retriesLeft: 2 }), 'autonomous'],
    ['AA3 재시도 소진 retry → HITL', ev({ kind: 'barrier-retry', idempotent: true, retriesLeft: 0 }), 'hitl'],
    ['위험 external-kill → HITL', ev({ kind: 'external-kill' }), 'hitl'],
    ['위험 destructive-reset → HITL', ev({ kind: 'destructive-reset' }), 'hitl'],
    ['위험 arming → HITL', ev({ kind: 'arming' }), 'hitl'],
    ['불명확 이벤트 → 기본거부 HITL', ev({ kind: 'wat' }), 'hitl'],
  ];
  for (const [desc, event, expected] of cases) {
    it(desc, () => { expect(decideExecutorControl(event).mode).toBe(expected); });
  }
  it('OBSERVE 상관(missionId·arcId·source) 이벤트가 결정에 남는다', () => {
    const d = decideExecutorControl(ev({ kind: 'barrier-reconcile', idempotent: true, arcId: 'arc2' }));
    expect(d.observeRef.missionId).toBe('apm_x');
    expect(d.observeRef.arcId).toBe('arc2');
    expect(d.observeRef.source).toContain('barrier-reconcile');
    expect(d.armed).toBe(false);
  });
});

describe('resolveExternalCompletionGate — AA4/AA5 완성 게이트(phase 8·외부 수습 2026-07-16)', () => {
  const done = { complete: true, source: 'PR #1', grounded: true, evidence: 'ok' };
  const fresh = { scope: ['f.ts'], freshness: 'fresh' as const };
  it('유효 grounded 완성 + fresh → no-op 완주', () => {
    expect(resolveExternalCompletionGate(done, fresh).autoComplete).toBe(true);
  });
  it('stale 경계 → 자동 완주 안 함(수동 검토)', () => {
    expect(resolveExternalCompletionGate(done, { scope: [], freshness: 'stale' }).autoComplete).toBe(false);
  });
  it('미완성 → 자동 완주 안 함', () => {
    expect(resolveExternalCompletionGate({ ...done, complete: false }, fresh).autoComplete).toBe(false);
  });
  it('reuseBoundary 는 손실 없이 전달(AA5)', () => {
    expect(resolveExternalCompletionGate(done, fresh).reuse).toEqual(fresh);
  });
});

describe('reconcilePostRun — AA6 완주 후 정합성 회고(phase 9·외부 수습·읽기전용)', () => {
  it('clean 트리 + 범위 내 → 정합·followUp none·armed=false', () => {
    const r = reconcilePostRun({ gitStatusPorcelain: [], approvedScope: ['src/autopilot'], deliveredFiles: ['src/autopilot/x.ts'] });
    expect(r.workingTreeClean).toBe(true);
    expect(r.scopeConsistent).toBe(true);
    expect(r.followUp).toBe('none');
    expect(r.armed).toBe(false);
  });
  it('dirty 트리 → 언커밋 불일치·followUp hitl(자동 수정 없음)', () => {
    const r = reconcilePostRun({ gitStatusPorcelain: [' M a.ts', '?? b.ts'], approvedScope: ['src'], deliveredFiles: [] });
    expect(r.workingTreeClean).toBe(false);
    expect(r.mismatches.some((m) => m.includes('언커밋'))).toBe(true);
    expect(r.followUp).toBe('hitl');
  });
  it('범위 밖 배송 → 불일치·followUp hitl', () => {
    const r = reconcilePostRun({ gitStatusPorcelain: [], approvedScope: ['src/autopilot'], deliveredFiles: ['apps/pwa/out/x'] });
    expect(r.scopeConsistent).toBe(false);
    expect(r.mismatches.some((m) => m.includes('범위 밖'))).toBe(true);
    expect(r.followUp).toBe('hitl');
  });
  it('자동 경로는 항상 armed=false(자동 clean/reset/commit 금지)', () => {
    expect(reconcilePostRun({ gitStatusPorcelain: [' M x'], approvedScope: [], deliveredFiles: [] }).armed).toBe(false);
  });
});
