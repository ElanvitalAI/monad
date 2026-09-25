import { test, expect, describe } from 'bun:test';
import { buildMissionBriefing, formatBriefingSummary, formatBriefingReport, type BriefingReaders } from './mission-briefing.js';
import type { MissionArc } from '../task-orchestrator/mission.js';

const arc = (name: string, status: MissionArc['status'], n: number): MissionArc => ({ arcId: `arc_${name}`, name, intent: '', phaseIds: Array.from({ length: n }, (_, i) => `p${i}`), dependsOnArcs: [], acceptance: [], status });

const readers: BriefingReaders = {
  revisions: () => ({ currentGoal: '적응형 투자 코디네이터(정착)', history: [
    { generation: 0, goal: '적응형 투자 코디네이터(원초·7페이즈 flat)', reason: 'revise', phases: [{ title: 'a', status: 'done' }, { title: 'b', status: 'done' }] },
    { generation: 1, goal: '범위축소: 전이확률 제외', reason: 'revise', phases: [{ title: 'a', status: 'done' }] },
  ] }),
  history: () => [
    { ts: '2026-07-15T01:00:00Z', kind: 'decision', op: 're-ground', summary: '[operator] A1 crit2 arming' },
    { ts: '2026-07-15T02:00:00Z', kind: 'split', op: 'split', summary: '' },
    { ts: '2026-07-15T03:00:00Z', kind: 'edit', op: 'skip-phase', summary: '[operator] canary skip' },
    { ts: '2026-07-15T04:00:00Z', kind: 'drift', op: 'drift', summary: '아크 오판' },
  ],
  mission: () => ({ arcs: [arc('관측', 'done', 12), arc('판단', 'done', 2), arc('canary', 'descoped', 2)], status: 'active' }),
  phases: () => [
    { title: '판단 정책을 구현하라', status: 'done', prUrl: 'https://gh/pr/4229', isImpl: true },
    { title: '계약 중재를 구현하라', status: 'done', prUrl: 'https://gh/pr/4229', isImpl: true },
    { title: '조사만 하라', status: 'done', isImpl: false },
    { title: 'canary 주문 라우팅 구현', status: 'done', isImpl: true }, // PR 없음 → drift 경고
  ],
  resourceCount: () => 3,
};

describe('buildMissionBriefing — 실집행 전 종합 브리핑', () => {
  test('① 골 진화 — 원초→중간→현재(정착) 대비', () => {
    const b = buildMissionBriefing('apm_x', { readers });
    expect(b.goalEvolution.length).toBeGreaterThanOrEqual(3); // gen0·gen1·current
    expect(b.goalEvolution[0]!.goal).toContain('원초');
    expect(b.goalEvolution[b.goalEvolution.length - 1]!.reason).toBe('current');
    expect(b.currentGoal).toContain('정착');
  });

  test('① 골 진화 — no-op 세대 접기(rerun/rebuild 동일 골+페이즈 연속 중복 제거·B5)', () => {
    // a6230f 형: 골 불변인데 rerun/rebuild 로 동일 스냅샷이 연달아 쌓임 → 구조 전이만 남겨야.
    const G = '적응형 투자 코디네이터';
    const collapseReaders: BriefingReaders = {
      revisions: () => ({ currentGoal: G, history: [
        { generation: 0, goal: G, reason: 'revise', phases: [] },                              // 0페이즈
        { generation: 6, goal: G, reason: 'rebuild', phases: [{ title: 'a', status: 'done' }] },// 1 → 전이
        { generation: 7, goal: G, reason: 'rerun', phases: [{ title: 'a', status: 'done' }] },  // 1 → 중복(접힘)
        { generation: 8, goal: G, reason: 'rerun', phases: [{ title: 'a', status: 'done' }] },  // 1 → 중복(접힘)
      ] }),
      phases: () => [{ title: 'a', status: 'done', isImpl: true }, { title: 'b', status: 'done', isImpl: true }], // 2 → 정착 전이
    };
    const b = buildMissionBriefing('apm_a6', { readers: collapseReaders });
    // 0페이즈 → 1페이즈 → 2페이즈(current) = 3 의미 전이(중복 gen7·8 접힘).
    expect(b.goalEvolution.map((g) => g.phaseCount)).toEqual([0, 1, 2]);
    expect(b.goalEvolution[b.goalEvolution.length - 1]!.reason).toBe('current');
  });

  test('② 여정 — split/편집/결정/drift/외부개입 롤업', () => {
    const b = buildMissionBriefing('apm_x', { readers });
    expect(b.journey.splits).toBe(1);
    expect(b.journey.edits).toBe(1);
    expect(b.journey.decisions).toBe(1);
    expect(b.journey.drifts).toBe(1);
    expect(b.journey.externalInterventions).toBe(1); // operator 언급
  });

  test('③ 산출물 grounded 점검 — PR 실존 + done인데 PR 없으면 drift 경고', () => {
    const b = buildMissionBriefing('apm_x', { readers });
    expect(b.deliverables.prUrls).toContain('https://gh/pr/4229');
    expect(b.deliverables.logicPhases.length).toBe(3); // impl done 3
    expect(b.deliverables.driftWarnings.length).toBe(1); // canary done·PR없음
    expect(b.deliverables.driftWarnings[0]!.phase).toContain('canary');
  });

  test('③.5 분해 계획 — 미빌드(계획) 페이즈가 승인 UX 에 노출(대표 2026-07-16)', () => {
    // 갓 분해된 미션: 산출물(done)은 0 이나 분해 계획(전 페이즈)은 보여야 한다.
    const planReaders: BriefingReaders = {
      ...readers,
      phases: () => [
        { title: 'Map existing extension points', status: 'backlog', isImpl: false },
        { title: 'Wire guarded AA1 heal', status: 'backlog', isImpl: true },
        { title: 'Wire AA6 reconciliation', status: 'backlog', isImpl: true },
      ],
    };
    const b = buildMissionBriefing('apm_plan', { readers: planReaders });
    // plan = 전 페이즈(제목·상태), deliverables 와 별개.
    expect(b.plan.map((p) => p.title)).toEqual([
      'Map existing extension points', 'Wire guarded AA1 heal', 'Wire AA6 reconciliation',
    ]);
    expect(b.settlement.phasesDone).toBe(0);
    expect(b.deliverables.logicPhases.length).toBe(0); // 완료 산출물 0
    // 요약 카드: phasesDone<total 이면 분해 계획 섹션 노출.
    const summary = formatBriefingSummary(b);
    expect(summary).toContain('분해 계획 (0/3)');
    expect(summary).toContain('Wire AA6 reconciliation');
    // 리포트: ③.5 섹션에 전 페이즈 상태.
    expect(formatBriefingReport(b)).toContain('③.5 분해 계획');
  });

  test('③.5 분해 계획 — 전부 done 이면 요약 카드에서 생략(노이즈 방지)', () => {
    const b = buildMissionBriefing('apm_x', { readers }); // 4 페이즈 전부 done
    expect(b.plan.length).toBe(4);
    expect(formatBriefingSummary(b)).not.toContain('분해 계획'); // phasesDone==total → 생략
  });

  test('stage-aware 가독성 — 빌드 전 미션: 아크 한줄씩·무의미 0팩트 접기(대표 2026-07-16)', () => {
    const planReaders: BriefingReaders = {
      ...readers,
      history: () => [], // 여정 0 강제 → 접혀야 함
      mission: () => ({ status: 'planning', arcs: [
        { name: '아크 A — 무해한 가드', status: 'pending', phaseIds: ['p0', 'p1'] },
        { name: '아크 B — executor 자율관리', status: 'pending', phaseIds: ['p2'] },
      ] } as unknown as { arcs: []; status: string }),
      phases: () => [
        { title: '자율 ACT 확장점 조사', status: 'backlog', isImpl: false },
        { title: 'AA1 힐 자동집행 배선', status: 'backlog', isImpl: true },
      ],
    };
    const s = formatBriefingSummary(buildMissionBriefing('apm_plan', { readers: planReaders }));
    expect(s).toContain('승인 대기(빌드 전)');
    // 아크 — 이름 전체를 한 줄에 하나씩(8자 슬라이스 깨짐 수복).
    expect(s).toContain('· 아크 A — 무해한 가드 [pending]');
    expect(s).toContain('· 아크 B — executor 자율관리 [pending]');
    // 전부 0 인 여정/산출물은 접힌다(의미 없는 팩트 나열 제거).
    expect(s).not.toContain('여정:');
    expect(s).not.toContain('산출물:');
    expect(s).toContain('armed=false');
  });

  test('③b grounded reader 있으면 reconcile drift 로 확정(현실 관측·B2)', () => {
    const groundedReaders: BriefingReaders = {
      ...readers,
      grounded: () => [
        { phaseTitle: '판단 정책을 구현하라', drift: false, note: 'PR #4229 merged — 랜딩 확인.', recordedPr: 4229, perceived: 'landed' },
        { phaseTitle: 'canary 주문 라우팅 구현', drift: true, note: "PR #9 닫힘 + deliverable 도 main 에 없음 — 실제 미완 (기록 'done'은 거짓·drift).", recordedPr: 9, perceived: 'incomplete' },
      ],
    };
    const b = buildMissionBriefing('apm_x', { readers: groundedReaders });
    expect(b.deliverables.groundedChecked).toBe(true);
    expect(b.deliverables.driftWarnings.length).toBe(1);
    expect(b.deliverables.driftWarnings[0]!.phase).toContain('canary');
    expect(b.deliverables.driftWarnings[0]!.issue).toContain('거짓');
    // B7 심각도 — incomplete=완주 차단(blocking).
    expect(b.deliverables.driftWarnings[0]!.severity).toBe('blocking');
    expect(b.deliverables.blockingDrifts).toBe(1);
  });

  test('③d drift 심각도 분류 — incomplete/pending=blocking · landed-elsewhere=benign(B7)', () => {
    const sevReaders: BriefingReaders = {
      ...readers,
      grounded: () => [
        { phaseTitle: 'A 미머지', drift: true, note: 'PR #1 아직 열림', recordedPr: 1, perceived: 'pending' },
        { phaseTitle: 'B 미완', drift: true, note: 'PR #2 닫힘+deliverable 없음', recordedPr: 2, perceived: 'incomplete' },
        { phaseTitle: 'C 타PR랜딩', drift: true, note: 'PR #3 닫힘, 다른 PR #99 로 랜딩', recordedPr: 3, perceived: 'landed-elsewhere' },
      ],
    };
    const b = buildMissionBriefing('apm_x', { readers: sevReaders });
    expect(b.deliverables.driftWarnings.length).toBe(3);
    expect(b.deliverables.blockingDrifts).toBe(2); // pending + incomplete
    const bySev = (s: string) => b.deliverables.driftWarnings.filter((d) => d.severity === s).map((d) => d.phase);
    expect(bySev('blocking').sort()).toEqual(['A 미머지', 'B 미완']);
    expect(bySev('benign')).toEqual(['C 타PR랜딩']);
    // 요약은 완주 차단만 ⛔ 경고, benign 은 ℹ️ 참고.
    const s = formatBriefingSummary(b);
    expect(s).toContain('⛔ 완주 차단: 2건');
    const rep = formatBriefingReport(b);
    expect(rep).toContain('완주 차단');
    expect(rep).toContain('해결됨');
  });

  test('③c grounded reader 없으면 title 휴리스틱 폴백(groundedChecked=false)', () => {
    const b = buildMissionBriefing('apm_x', { readers });
    expect(b.deliverables.groundedChecked).toBe(false);
    expect(b.deliverables.driftWarnings.length).toBe(1); // 폴백: canary done·PR 없음
  });

  test('④ 정착 — 아크 상태·페이즈 카운트', () => {
    const b = buildMissionBriefing('apm_x', { readers });
    expect(b.settlement.arcs.map((a) => a.status)).toEqual(['done', 'done', 'descoped']);
    expect(b.settlement.phasesDone).toBe(4);
    expect(b.settlement.missionStatus).toBe('active');
  });

  test('요약/리포트 렌더 — 승인 대상 + drift 경고 노출', () => {
    const b = buildMissionBriefing('apm_x', { pendingArming: { phaseId: 'p14', title: 'canary 주문 라우팅' }, readers });
    const s = formatBriefingSummary(b);
    expect(s).toContain('최종 브리핑');
    expect(s).toContain('진화:');
    expect(s).toContain('실집행 승인 대상');
    expect(s).toContain('⛔ 완주 차단');
    const rep = formatBriefingReport(b);
    expect(rep).toContain('① 골 진화');
    expect(rep).toContain('③ 실제 산출물 grounded 점검');
    expect(rep).toContain('미확정');
  });

  test('R0 모델 선택 근거 reader는 브리핑에 선택적으로 붙는다', () => {
    const b = buildMissionBriefing('apm_x', { readers: {
      ...readers,
      routeDecision: () => ({ provider: 'openai-codex', model: 'gpt-5.6-terra', effort: 'low', source: 'codex-tier-policy', rationale: 'Codex-first build: terra coding tier', mission: 'build' }),
    } });
    expect(b.routeDecision).toMatchObject({ model: 'gpt-5.6-terra', source: 'codex-tier-policy' });
    expect(formatBriefingSummary(b)).toContain('openai-codex/gpt-5.6-terra');
    expect(formatBriefingReport(b)).toContain('모델 선택 근거');
  });
});
