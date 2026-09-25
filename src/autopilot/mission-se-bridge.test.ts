// ── mission-se-bridge 단위테스트 — classifyPhaseKind(실 미션 7페이즈 회귀 픽스처) +
//    seResultToPhaseResult 매핑 + runImplementationPhaseViaSE(disarmed/armed 분기·주입). ──
import { describe, it, expect } from 'bun:test';
import {
  classifyPhaseKind,
  classifyPhaseKindSmart,
  seResultToPhaseResult,
  summarizeGateFailure,
  runImplementationPhaseViaSE,
  phaseSlug,
  isStructuralFailure,
  SE_BUDGET_LADDER,
  resolveSeImplementationAttempts,
  buildGroundedRecoveryDirective,
  mergedPrForPhase,
} from './mission-se-bridge.js';

// notes 를 실은 페이즈 픽스처(하단 hoisted mkTask 재사용).
const taskWithNotes = (notes: string[]) => ({ ...mkTask({ title: 't' }), notes });
const PR_NOTE = '[SE-PR] https://github.com/ElanvitalAI/monad/pull/4165';

describe('mergedPrForPhase — merge된 PR 재빌드 스킵 판정', () => {
  it('[SE-PR] merged 이면 PR 번호 반환', () => {
    expect(mergedPrForPhase(taskWithNotes([PR_NOTE]), () => true)).toBe('#4165');
  });
  it('[SE-PR] 미merge 면 null(정당한 rebuild 보존)', () => {
    expect(mergedPrForPhase(taskWithNotes([PR_NOTE]), () => false)).toBeNull();
  });
  it('[SE-PR] 노트 없으면 null', () => {
    expect(mergedPrForPhase(taskWithNotes(['[CRITIQUE] x']), () => true)).toBeNull();
    expect(mergedPrForPhase(taskWithNotes([]), () => true)).toBeNull();
  });
  it('checkMerged throw 시 fail-open(null·정상 빌드)', () => {
    expect(mergedPrForPhase(taskWithNotes([PR_NOTE]), () => { throw new Error('gh down'); })).toBeNull();
  });
});

describe('isStructuralFailure — 조기 분할 게이트(대표 2026-07-13)', () => {
  it('구조적 실패(예산 증액 무의미) → true', () => {
    expect(isStructuralFailure('새 API가 기존 serializer 에 연결되지 않아')).toBe(true); // dead-code
    expect(isStructuralFailure('범위밖 변경 1건: src/task-orchestrator/mission.ts')).toBe(true); // scope
    expect(isStructuralFailure('가짜 no-op — 변경 0')).toBe(true); // no-op
    expect(isStructuralFailure('계획 배선에 미달(미완/훼손)')).toBe(true);
  });
  it('순수 budget 실패(더 큰 예산이 답) → false (에스컬레이션 유지)', () => {
    expect(isStructuralFailure('무결성 게이트 실패 — bun test 미통과 (3개 실패)')).toBe(false);
    expect(isStructuralFailure('예산 소진으로 검증 미완')).toBe(false);
  });
  it('예산 ladder 2번째=400(대표 지시·opus 전 조기 분할 여지)', () => {
    expect(SE_BUDGET_LADDER[1]).toBe(400);
    expect([...SE_BUDGET_LADDER]).toEqual([150, 400, 1000]);
  });
});

describe('resolveSeImplementationAttempts — R1 Codex-first paid escalation boundary', () => {
  it('evidence-hitl policy keeps automatic retries on the active coding backend', () => {
    expect(resolveSeImplementationAttempts({
      backend: 'monad-self:gpt-5.6-terra', ladder: [150, 400, 1000],
      routePolicy: { mode: 'codex-first', opusEscalation: 'evidence-hitl' },
    })).toEqual([
      { backend: 'monad-self:gpt-5.6-terra', maxTurns: 150 },
      { backend: 'monad-self:gpt-5.6-terra', maxTurns: 400 },
      { backend: 'monad-self:gpt-5.6-terra', maxTurns: 1000 },
    ]);
  });

  it('authorized system repair remains the explicit Opus exception', () => {
    expect(resolveSeImplementationAttempts({
      backend: 'monad-self:claude-opus-4-8', ladder: [150, 400],
      routePolicy: { opusEscalation: 'evidence-hitl' }, systemRepairAuthorized: true,
    }).map((attempt) => attempt.backend)).toEqual([
      'monad-self:claude-opus-4-8', 'monad-self:claude-opus-4-8',
    ]);
  });
});
import type { Task } from '../task-orchestrator/types.js';
import type { NocturnalResult } from './build/nocturnal-runner.js';

function mkTaskId(id: string, title: string): Task {
  return { ...mkTask({ title }), id } as Task;
}

describe('phaseSlug — 한글 title 충돌 방지(2026-07-12 dogfood 회귀)', () => {
  const M = 'apm_memory-lifecycle-decay-compression-s3-archive_423935';
  it('slugify 폴백이 같은 두 한글 페이즈 → 다른 slug (worktree/브랜치 충돌 방지)', () => {
    // 실 버그: [2]"보존 점수…"·[3]"세션 종료…" 둘 다 slugify='proposal' → 충돌.
    const s2 = phaseSlug(M, mkTaskId('task:397df92f2f91', '보존 점수와 의미 압축 정책을 구현하라'));
    const s3 = phaseSlug(M, mkTaskId('task:0e32d03f3877', '세션 종료를 멱등 요약 승격으로 통합하라'));
    expect(s2).not.toBe(s3);
    expect(s2).toContain('397df92f');
    expect(s3).toContain('0e32d03f');
  });
  it('미션 접두 + 영문 title slug 포함(가독성)', () => {
    const s = phaseSlug(M, mkTaskId('task:7163eced2513', 'KGS에 생애주기 메타데이터를 추가하라'));
    expect(s).toContain('memory-lifecycle');
    expect(s).toContain('kgs');
    expect(s).toContain('7163eced');
  });
});

function mkTask(over: { title: string; description?: string; prompt?: string; criteria?: string[] }): Task {
  return {
    id: 'task:t1', createdAt: 0, updatedAt: 0, version: 1,
    title: over.title, description: over.description ?? '',
    surface: { kind: 'subagent', definitionName: 'phase', prompt: over.prompt ?? '' },
    dependsOn: [], priority: 'high', isolation: 'shared', maxRetries: 2, attempt: 0,
    status: 'ready', notes: [], triggerChain: [],
    ...(over.criteria ? { acceptance: { criteria: over.criteria } } : {}),
  } as Task;
}

// 실 dogfood 미션(apm_memory-lifecycle-...423935)의 7페이즈 요약 — 회귀 가드.
// [0]만 operational(조사·read-only), [1~6]은 implementation(코어/테스트 편집).
const REAL_PHASES: Array<{ kind: 'implementation' | 'operational'; t: Task }> = [
  { kind: 'operational', t: mkTask({
    title: '기존 기억 생애주기 확장 지점을 추적하라',
    prompt: '읽기 전용으로 docs/RESEARCH-memory-lifecycle-compaction.md, src/domains/memory-lifecycle.ts, src/knowledge/kgs/sqlite-store.ts 를 조사한다. 재사용할 핵심 export 최대 5개를 세션 결과에 명시하며 파일은 수정하지 않는다.' }) },
  { kind: 'implementation', t: mkTask({
    title: 'KGS에 생애주기 메타데이터를 추가하라',
    prompt: '기존 migration 및 transaction helper를 재사용해 src/knowledge/kgs/sqlite-store.ts, src/knowledge/kgs/pack.ts 에 tier, lastAccessedAt, recallCount 필드를 추가한다. 기존 pack/unpack 및 write export를 확장한다.' }) },
  { kind: 'implementation', t: mkTask({
    title: '보존 점수와 의미 압축 정책을 구현하라',
    prompt: 'src/domains/memory-lifecycle.ts의 기존 runner와 memory-consolidate.ts의 export를 확장한다.' }) },
  { kind: 'implementation', t: mkTask({
    title: '세션 종료를 멱등 요약 승격으로 통합하라',
    prompt: 'src/session/session-store.ts에 공통 session-summary job 경계를 두고 src/nexus/chat/session.ts 종료 경로가 이를 호출하도록 연결한다.' }) },
  { kind: 'implementation', t: mkTask({
    title: 'Cold 이관과 느린 복원 경로를 연결하라',
    prompt: '기존 S3 adapter와 src/knowledge/kgs/sqlite-store.ts transaction API를 재사용해 src/domains/memory-lifecycle.ts의 cold 단계에 archive/restore를 연결한다.' }) },
  { kind: 'implementation', t: mkTask({
    title: '기존 새벽 스케줄러에 생애주기 순서를 등록하라',
    prompt: 'scripts/memory-lifecycle-cycle.ts와 src/domains/memory-lifecycle.ts의 기존 runner를 확장하고 src/workflow-runtime/triggers/scheduler.ts의 trigger 등록 API에 새벽 idle 실행을 등록한다.' }) },
  { kind: 'implementation', t: mkTask({
    title: '생애주기 실패·재실행 시나리오를 검증하라',
    prompt: '기존 test 디렉터리와 SQLite/S3 mock helper만 재사용해 검증 코드만 추가한다. production 코드는 이 단계에서 기능 확장하지 않는다.' }) },
];

describe('classifyPhaseKind — 실 미션 7페이즈 회귀', () => {
  for (const [i, { kind, t }] of REAL_PHASES.entries()) {
    it(`페이즈 [${i}] ${t.title.slice(0, 20)} → ${kind}`, () => {
      expect(classifyPhaseKind(t)).toBe(kind);
    });
  }
});

// ★ price-guard 미션(apm_conatus-price-guard...4ca472) 페이즈0 회귀(2026-07-13 dogfood 버그):
//   "조사 전용 단계다 + 변경 파일은 없으며" 인데 내부 grounding(조사 대상 src 경로 + "재사용·확장")이
//   CORE_PATH+EDIT_VERB 규칙에 걸려 implementation 오분류 → SE 격리 오라우팅 → 새 문서(untracked)
//   diff 미캡처 → "검증 불가 FAIL" 무한 반복 → opus(유료) 소진. EXPLICIT_READONLY 로 명시적 조사
//   전용 선언을 grounding 문구보다 우선해 operational(walker·조사 예산 32k~128k) 확정.
describe('classifyPhaseKind — 조사 전용 선언 우선(price-guard 페이즈0 회귀·2026-07-13)', () => {
  it('조사 전용 + grounding(src 경로·재사용·확장) → operational (구현 오분류 금지)', () => {
    const t = mkTask({
      title: '레거시 규칙과 현행 파이프라인 재사용 지점을 확정하라',
      description: '조사 전용 단계다. src/autopilot/proposal/phased-plan.ts, src/shell-primitive/sandbox.ts 를 읽고 실제 export 를 대조한다. 변경 파일은 없으며 최대 12개로 한정해 출력한다.',
      criteria: ['핵심 export 5~12개 식별', '기존 파일 12 재사용·확장·중복금지 지점을 명시'],
    });
    expect(classifyPhaseKind(t)).toBe('operational');
  });
  it('"스파이크" 문구도 operational', () => {
    expect(classifyPhaseKind(mkTask({ title: '현재 구현과 빈 고리를 스파이크하라', description: '조사 전용 단계다.' }))).toBe('operational');
  });
  it('진짜 구현 페이즈는 여전히 implementation (과교정 방지)', () => {
    const t = mkTask({
      title: '가격 가드 판정 정책을 순수 함수로 구현하라',
      description: 'src/domains/price-guard.ts 에 판정 함수를 작성하고 단위테스트를 추가한다.',
    });
    expect(classifyPhaseKind(t)).toBe('implementation');
  });

  it('크론/스케줄 등록(운영 액션) → operational (price-guard 페이즈4 회귀·2026-07-13)', () => {
    expect(classifyPhaseKind(mkTask({
      title: '장중 5분 크론 하나로 가격 가드를 등록하라',
      description: '기존 price-guard-cycle.ts 를 monad schedule 로 장중 5분 주기 크론 1개 등록한다.',
    }))).toBe('operational');
  });

  it('크론 매니저 "구현"(코드 작성)은 implementation 유지(과교정 방지)', () => {
    expect(classifyPhaseKind(mkTask({
      title: '크론 스케줄러를 구현하라',
      description: 'src/scheduler.ts 에 크론 등록 로직을 구현한다.',
    }))).toBe('implementation');
  });
});

describe('classifyPhaseKind — 경계 케이스', () => {
  it('순수 조사(read-only 명시) → operational', () => {
    expect(classifyPhaseKind(mkTask({ title: 'X 조사', prompt: 'src/a.ts 를 읽고 파악. 파일은 수정하지 않는다.' }))).toBe('operational');
  });
  it('구현 계획 문서 작성(구현 언급하나 문서) → operational', () => {
    // "구현" 단어가 있어도 read-only 문서면 operational (강한 구현동사 "구현하라" 아님).
    expect(classifyPhaseKind(mkTask({ title: '설계 문서 작성', prompt: '구현 방향을 정리한 설계 문서를 작성한다. 코드는 수정하지 않는다.' }))).toBe('operational');
  });
  it('명시 구현 동사 → implementation', () => {
    expect(classifyPhaseKind(mkTask({ title: 'Y 를 구현하라', prompt: '함수를 작성한다.' }))).toBe('implementation');
  });
  it('테스트 저작 → implementation (test/ 보호경로)', () => {
    expect(classifyPhaseKind(mkTask({ title: 'Z 검증', prompt: '검증 코드만 추가한다. mock helper 재사용.' }))).toBe('implementation');
  });
  it('코어 경로 + 편집 동사 → implementation', () => {
    expect(classifyPhaseKind(mkTask({ title: 'W 배선', prompt: 'src/foo/bar.ts 에 핸들러를 등록한다.' }))).toBe('implementation');
  });
  it('스케줄 등록만(코어 경로 없음) → operational', () => {
    expect(classifyPhaseKind(mkTask({ title: '알림 크론 등록', prompt: '매일 08:00 브리핑 스케줄을 등록한다.' }))).toBe('operational');
  });
});

describe('seResultToPhaseResult — 매핑', () => {
  const T = { id: 'm1', slug: 's', title: 't', planPath: '/x.md' };
  it('built → ok + PR + VERDICT: PASS', () => {
    const r = seResultToPhaseResult({ status: 'built', target: T, prUrl: 'http://pr/1', next: 'x' } as NocturnalResult);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('http://pr/1');
    expect(r.summary).toContain('VERDICT: PASS');
  });
  it('disarmed → fail + arming 대기 안내', () => {
    const r = seResultToPhaseResult({ status: 'disarmed', target: T, next: 'x' } as NocturnalResult);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('arming 대기');
  });
  it('gate-failed → fail + bun test detail(대표 2026-07-12·명확한 cause)', () => {
    const r = seResultToPhaseResult({ status: 'gate-failed', target: T, next: 'x',
      evidence: { passed: false, steps: [], log: '(fail) memory-archive > cold restore\n 12 pass\n 1 fail\n' } } as NocturnalResult);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('bun test 미통과');
    expect(r.summary).toContain('1개 실패'); // 실패 수
    expect(r.summary).not.toContain('무결성 게이트 실패 — 대표 리포트'); // 중복 r.next 안 붙음
  });
  it('core-violation → fail', () => {
    expect(seResultToPhaseResult({ status: 'core-violation', target: T, next: 'x' } as NocturnalResult).ok).toBe(false);
  });
});

describe('summarizeGateFailure — bun test 실패 발췌(대표 2026-07-12)', () => {
  it('실패 수 + 첫 실패 테스트 추출', () => {
    const s = summarizeGateFailure({ passed: false, steps: [], log: '(fail) foo > bar\n 3 fail\n' } as never);
    expect(s).toContain('3개 실패');
    expect(s).toContain('foo > bar');
  });
  it('로그 없으면 빈 문자열', () => {
    expect(summarizeGateFailure(undefined)).toBe('');
  });
});

describe('runImplementationPhaseViaSE — disarmed/armed 분기', () => {
  const task = mkTask({ title: 'X 를 구현하라', prompt: 'src/a.ts 작성' });
  const writePlanStub = () => '/tmp/plan.md';

  it('disarmed → arming 대기 보고, runOne 호출 안 함(worktree 미생성)', async () => {
    let called = false;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: false, writePlan: writePlanStub, log: () => {},
      runOne: async () => { called = true; return { status: 'built', next: '' } as NocturnalResult; },
    });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('arming 대기');
    expect(called).toBe(false); // 격리 worktree 생성 비용 회피
  });

  it('armed + built → ok + PR (runOne 실배선 주입)', async () => {
    let seenSlug = '';
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({}) ) as never,
      runOne: async (target) => { seenSlug = target.slug; return { status: 'built', target, prUrl: 'http://pr/9', next: 'ok' } as NocturnalResult; },
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('http://pr/9');
    expect(seenSlug.length).toBeGreaterThan(0); // slug 파생됨
  });

  // ★ grounded no-op 검증(대표 2026-07-14) — i>0 no-change 를 무조건 FAIL 하지 않고 코드 실독으로
  //   "이미 충족?" 확증 시 PASS. 순수 신호(이전 diff 존재)로는 진짜/가짜 구분 불가한 결함 수리.
  it('i>0 no-change + grounded 충족 → 자동 PASS(실패 구제)', async () => {
    const statuses = ['gate-failed', 'no-change'];
    let call = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => ({ status: statuses[call++]!, target, next: 'x' }) as NocturnalResult,
      triageClassify: async () => 'retry-escalate',
      verifyNoop: async () => ({ satisfied: true, evidence: 'doc-curation.ts:174 idempotencyKey', missing: '', grounded: true }),
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('이미 구현');
  });

  it('i>0 no-change + grounded 미충족 + 리커버리 off → 보수적 FAIL 유지(false-PASS 금지)', async () => {
    const statuses = ['gate-failed', 'no-change'];
    let call = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => ({ status: statuses[call++]!, target, next: 'x' }) as NocturnalResult,
      triageClassify: async () => 'retry-escalate',
      verifyNoop: async () => ({ satisfied: false, evidence: '', missing: '스냅샷 가드 미완', grounded: true }),
      recoverGrounded: false, // 순수 grounded-fail 경로만(리커버리 격리)
    });
    expect(r.ok).toBe(false);
  });

  // ★ 시스템 리커버리(대표 2026-07-14) — grounded 미충족(missing) 을 버리지 않고 타겟 수정 1회 자동
  //   시도. 외부 판단 없이 시스템이 스스로 수렴. opus no-op → "이걸 반드시 닫아라" 강 타겟 가이드.
  it('grounded 미충족 → 타겟 리커버리 built 통과 → 자동 PASS(자가 수렴)', async () => {
    // terra gate-failed → opus no-change → grounded 미충족 → 리커버리 build → built(게이트 통과).
    const statuses = ['gate-failed', 'no-change', 'built'];
    let call = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => (statuses[call] === 'built'
        ? { status: statuses[call++]!, target, prUrl: 'http://pr/42', next: 'ok' }
        : { status: statuses[call++]!, target, next: 'x' }) as NocturnalResult,
      triageClassify: async () => 'retry-escalate',
      verifyNoop: async () => ({ satisfied: false, evidence: '', missing: 'validateSignalEnvelope 미래 타임스탬프 미거부', grounded: true }),
    });
    expect(r.ok).toBe(true);
    expect(call).toBe(3); // terra + opus + 리커버리
  });

  it('grounded 미충족 → 리커버리도 no-change → 교착 감지 → revise 권장(대표 2026-07-14·C)', async () => {
    // 리커버리 opus 도 변경 0(no-change) = 구현자-검증자 교착. 재시도 무의미 → [SE triage: revise].
    const statuses = ['gate-failed', 'no-change', 'no-change'];
    let call = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => ({ status: statuses[call++]!, target, next: 'x' }) as NocturnalResult,
      triageClassify: async () => 'retry-escalate',
      verifyNoop: async () => ({ satisfied: false, evidence: '', missing: '메타데이터·부모ID 미완', grounded: true }),
    });
    expect(r.ok).toBe(false);
    expect(call).toBe(3);                          // 리커버리 1회 후 중단(바운드)
    expect(r.summary).toContain('[SE triage: revise]'); // 교착 → 범위축소 라우팅(재구현 아님)
    expect(r.summary).toContain('교착');
  });

  it('grounded 미충족 → 리커버리 gate-failed(교착 아님) → 일반 FAIL 유지', async () => {
    // 리커버리가 변경은 만들었으나(gate-failed) 통과 못 함 → 교착 아님(재구현 여지). 일반 실패.
    const statuses = ['gate-failed', 'no-change', 'gate-failed'];
    let call = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => ({ status: statuses[call++]!, target, next: 'x' }) as NocturnalResult,
      triageClassify: async () => 'retry-escalate',
      verifyNoop: async () => ({ satisfied: false, evidence: '', missing: '여전히 미완', grounded: true }),
    });
    expect(r.ok).toBe(false);
    expect(r.summary).not.toContain('교착');       // 교착 아님(변경은 있었음)
  });

  // ★ 자기치유 grounded 유도(#4108 차용·대표 2026-07-14) — 다음 rung 을 돌기 *전에* 검증해
  //   충족이면 PASS 단축(rung 낭비 0)·미충족이면 missing 을 다음 rung 에 주입(no-op 예방).
  it('재시도 전 grounded 충족 확증 → 재시도 중단·즉시 PASS(opus rung 낭비 0)', async () => {
    let runCount = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => { runCount++; return { status: 'gate-failed', target, next: 'bun test 3 fail' } as NocturnalResult; },
      triageClassify: async () => 'retry-escalate',
      verifyNoop: async () => ({ satisfied: true, evidence: 'doc-curation.ts:174 already wired', missing: '', grounded: true }),
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('이미 구현');
    expect(runCount).toBe(1); // 첫 rung gate-failed 후 proactive grounded 충족 → opus rung 안 돎
  });

  it('재시도 전 grounded 미충족 → missing 을 다음 rung 에 주입 → 유도 재시도 built(no-op 예방)', async () => {
    let runCount = 0;
    let verifyCalled = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => {
        runCount++;
        return runCount === 1
          ? { status: 'gate-failed', target, next: 'incomplete' } as NocturnalResult
          : { status: 'built', target, prUrl: 'http://pr/heal', next: 'ok' } as NocturnalResult;
      },
      triageClassify: async () => 'retry-escalate',
      verifyNoop: async () => { verifyCalled++; return { satisfied: false, evidence: '', missing: 'doc-curate.ts 호출부에 existingIdempotencyKeys 배선 필요', grounded: true }; },
    });
    expect(r.ok).toBe(true);                 // 유도된 다음 rung(opus)에서 built
    expect(r.summary).toContain('http://pr/heal');
    expect(runCount).toBe(2);                // proactive 주입 후 opus rung 이 실제 돎
    expect(verifyCalled).toBeGreaterThan(0); // 재시도 전 grounded 진단 호출됨(주입 경로)
  });

  it('buildGroundedRecoveryDirective — missing 을 타겟 지시로(no-op 금지·원본 개정·재사용≠결함동결)', () => {
    const d = buildGroundedRecoveryDirective('validateSignalEnvelope 가 미래 observedAt 을 허용');
    expect(d).toContain('validateSignalEnvelope 가 미래 observedAt 을 허용');
    expect(d).toContain('변경 0(no-op)은 금지');
    expect(d).toContain('원본');           // 원본 in-place 개정
    expect(d).toContain('재사용은 결함 동결이 아니다');
    expect(d).toContain('최소 변경');
  });

  // ★ i=0 no-op dodge 게이트(대표 2026-07-14 · opus false no-op 실측) — 첫 시도 no-change 도
  //   grounded 검증을 태운다. 강한 모델이 게으르게 "됐다"고 dodge 해도 미충족이면 자동 PASS 금지.
  it('i=0 no-change + grounded 미충족(dodge) → 자동 PASS 안 함(false-PASS 차단)', async () => {
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self:claude-opus-4-8', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      // 첫 시도부터 no-change (opus dodge 시나리오) — 리커버리도 no-change 로 미충족 유지.
      runOne: async (target) => ({ status: 'no-change', target, next: '변경 불필요' }) as NocturnalResult,
      verifyNoop: async () => ({ satisfied: false, evidence: '', missing: 'golden-set top-k + 경계보정 API 미구현', grounded: true }),
    });
    expect(r.ok).toBe(false);              // dodge → PASS 아님 (구 로직은 여기서 false-PASS 였음)
  });

  it('i=0 no-change + grounded 충족 → 정당 no-op PASS(과교정 방지)', async () => {
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => ({ status: 'no-change', target, next: 'no-op' }) as NocturnalResult,
      verifyNoop: async () => ({ satisfied: true, evidence: 'src/x.ts:42 이미 구현', missing: '', grounded: true }),
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('이미 구현');
  });

  // ★ 페이즈 스택(대표 2026-07-13) — baseBranch 를 SE worktree base 로 전달(이전 산출물 위에 쌓임).
  it('baseBranch 지정 → seDeps.base 로 전달(페이즈 스택)', async () => {
    const bases: (string | undefined)[] = [];
    await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      baseBranch: 'origin/se/prev-phase',
      makeDeps: ((o: { base?: string }) => { bases.push(o.base); return {}; }) as never,
      runOne: async (target) => ({ status: 'built', target, prUrl: 'http://pr/1', next: 'ok' } as NocturnalResult),
    });
    expect(bases[0]).toBe('origin/se/prev-phase');
  });

  it('baseBranch 미지정 → main(독립·기존 동작)', async () => {
    const bases: (string | undefined)[] = [];
    await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self', writePlan: writePlanStub, log: () => {},
      makeDeps: ((o: { base?: string }) => { bases.push(o.base); return {}; }) as never,
      runOne: async (target) => ({ status: 'built', target, prUrl: 'http://pr/1', next: 'ok' } as NocturnalResult),
    });
    expect(bases[0]).toBe('main');
  });

  it('armed + gate-failed → 계단 소진 후 triage split(에스컬레이션 전 계단 다 시도)', async () => {
    const backends: string[] = [];
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self:gpt-5.6-terra', writePlan: writePlanStub, log: () => {},
      makeDeps: ((o: { backend: string }) => { backends.push(o.backend); return {}; }) as never,
      runOne: async (target) => ({ status: 'gate-failed', target, next: '무결성 실패' } as NocturnalResult),
    });
    expect(r.ok).toBe(false);
    // ★ 적응형 재시도 triage(대표 2026-07-14) — 계단(terra->opus 1000턴) 소진에도 미완이면 triage 가
    //   split 로 분류(과대 의심·사람 검토). test 는 휴리스틱(LLM 무호출·결정론).
    expect(r.summary).toContain('SE triage: split');
    expect(r.summary).toContain('VERDICT: FAIL');
    // ★ 계단은 그대로 다 시도 — 첫 턴 terra(저비용), 이후 opus. 모델 전환은 유지.
    expect(backends).toEqual([
      'monad-self:gpt-5.6-terra',
      'monad-self:claude-opus-4-8', 'monad-self:claude-opus-4-8',
    ]);
  });

  it('★ onProgress — 시도 시작·재시도·opus 폴백 변곡점 호출(대표 2026-07-12·진행 가시성)', async () => {
    const notes: string[] = [];
    await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self:gpt-5.6-terra', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      onProgress: (n) => notes.push(n),
      runOne: async (target) => ({ status: 'gate-failed', target, next: 'x' } as NocturnalResult),
    });
    // Layout A(2026-07-16) — 시도 시작 note 는 페이즈 카드 footer 로 접히는 '⚙ backend · 시도 N/M · bld' 형식.
    expect(notes.filter((n) => n.startsWith('⚙') && n.includes('시도')).length).toBe(3); // 3시도(terra 150 + opus 400·1000)
    expect(notes.some((n) => n.includes('예산 상향'))).toBe(true);
    expect(notes.some((n) => n.includes('opus 4.8 폴백'))).toBe(true);
  });

  it('★ opus 폴백 성공(대표 2026-07-12·최종 방어) — terra 다 실패 → opus 가 완주', async () => {
    let calls = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, backend: 'monad-self:gpt-5.6-terra', writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => {
        calls += 1;
        return calls <= 1
          ? ({ status: 'gate-failed', target, next: 'x' } as NocturnalResult) // terra 첫 턴 실패
          : ({ status: 'built', target, prUrl: 'http://pr/opus', next: 'ok' } as NocturnalResult); // opus 완주
      },
    });
    expect(r.ok).toBe(true); // opus(2번째 시도)가 완주
    expect(calls).toBe(2); // terra 1 + opus 1
    expect(r.summary).toContain('http://pr/opus');
  });
});

describe('SE 예산 자기 에스컬레이션 (대표 2026-07-12·①)', () => {
  const task = mkTask({ title: 'X 를 구현하라', prompt: 'src/a.ts 작성' });
  const writePlanStub = () => '/tmp/plan.md';

  it('gate-failed(예산 소진) → 예산 상향 재시도 → 다음 시도 built 성공', async () => {
    const budgetsSeen: number[] = [];
    let attempt = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, writePlan: writePlanStub, log: () => {},
      makeDeps: ((o: { maxTurns?: number }) => { budgetsSeen.push(o.maxTurns ?? 0); return {}; }) as never,
      runOne: async (target) => {
        attempt += 1;
        return attempt < 2
          ? ({ status: 'gate-failed', target, next: 'x' } as NocturnalResult)
          : ({ status: 'built', target, prUrl: 'http://pr/1', next: 'ok' } as NocturnalResult);
      },
    });
    expect(r.ok).toBe(true);
    expect(budgetsSeen).toEqual([150, 400]); // 150 실패(비구조적) → 400 상향 재시도 후 성공(계단 [150,400,1000])
  });

  it('★ 가짜 no-op 차단(대표 2026-07-12) — i>0 no-change 는 실패(1차 변경 gate-failed 후 미구현)', async () => {
    let attempt = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => {
        attempt += 1;
        return attempt === 1
          ? ({ status: 'gate-failed', target, next: 'x' } as NocturnalResult)   // 1차: 변경 만들어 gate-failed
          : ({ status: 'no-change', target, next: 'no-op' } as NocturnalResult);  // 2차: 갑자기 변경 0(가짜)
      },
    });
    expect(r.ok).toBe(false);              // 가짜 no-op → PASS 아님
    expect(r.summary).toContain('가짜 no-op');
    expect(attempt).toBe(2);               // 2차 즉시 실패(추가 에스컬레이션 안 함)
  });

  it('★ 정당한 no-op — 첫 시도(i=0) no-change 는 PASS(이미 구현)', async () => {
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => ({ status: 'no-change', target, next: 'no-op' } as NocturnalResult),
    });
    expect(r.ok).toBe(true);               // i=0 no-change 는 정당한 no-op PASS
  });

  it('built 첫 시도 성공 → 재시도 없음(1회)', async () => {
    let calls = 0;
    await runImplementationPhaseViaSE('m1', task, {
      armed: true, writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => { calls += 1; return { status: 'built', target, prUrl: 'p', next: '' } as NocturnalResult; },
    });
    expect(calls).toBe(1);
  });

  it('no-change(no-op) → 재시도 없음(성공으로 간주)', async () => {
    let calls = 0;
    const r = await runImplementationPhaseViaSE('m1', task, {
      armed: true, writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => { calls += 1; return { status: 'no-change', target, next: '변경 불필요' } as NocturnalResult; },
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('core-violation → 재시도 무의미(즉시 반환·1회)', async () => {
    let calls = 0;
    await runImplementationPhaseViaSE('m1', task, {
      armed: true, writePlan: writePlanStub, log: () => {},
      makeDeps: (() => ({})) as never,
      runOne: async (target) => { calls += 1; return { status: 'core-violation', target, next: 'x' } as NocturnalResult; },
    });
    expect(calls).toBe(1);
  });

  it('deps.maxTurns 커스텀 지정 → 그 값 1회(에스컬레이션 안 함·seam)', async () => {
    const budgetsSeen: number[] = [];
    let calls = 0;
    await runImplementationPhaseViaSE('m1', task, {
      armed: true, writePlan: writePlanStub, log: () => {}, maxTurns: 200,
      makeDeps: ((o: { maxTurns?: number }) => { budgetsSeen.push(o.maxTurns ?? 0); return {}; }) as never,
      runOne: async (target) => { calls += 1; return { status: 'gate-failed', target, next: 'x' } as NocturnalResult; },
    });
    expect(budgetsSeen).toEqual([200]); // 지정값 1회·에스컬레이션 안 함
    expect(calls).toBe(1);
  });
});

describe('runImplementationPhaseViaSE — 이식 #1 실행 전 적대적 플랜 비평(harness front-half)', () => {
  it('adversarialCritic 주입 → 레드팀 결함·보강안을 PLAN 에 사전 append', async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const planPath = join(mkdtempSync(join(tmpdir(), 'se-adv-')), 'plan.md');
    writeFileSync(planPath, '# PLAN\n원 계획\n');
    let criticCalled = false;
    const r = await runImplementationPhaseViaSE('m1', mkTask({ title: '라벨 헬퍼 구현', criteria: ['high/med/low 경계', '단위테스트'] }), {
      armed: true, backend: 'monad-self', log: () => {}, writePlan: () => planPath,
      adversarialCritic: async () => { criticCalled = true; return JSON.stringify({ sound: false, issues: ['경계 0.8 포함 여부 모호'], revisedSteps: ['0.8 이상 high 로 명시', '경계 테스트 추가'] }); },
      runOne: async (target) => ({ status: 'built', target, prUrl: 'http://pr/1', next: 'ok' }) as NocturnalResult,
    });
    expect(criticCalled).toBe(true);
    expect(r.ok).toBe(true);
    const plan = readFileSync(planPath, 'utf-8');
    expect(plan).toContain('사전 레드팀 점검');
    expect(plan).toContain('경계 0.8 포함 여부 모호');   // 결함 주입
    expect(plan).toContain('보강된 접근');               // revisedSteps 주입
  });

  it('critic 미주입(기본·test) → 비평 스킵·PLAN 무변경(무회귀)', async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const planPath = join(mkdtempSync(join(tmpdir(), 'se-adv0-')), 'plan.md');
    writeFileSync(planPath, '# PLAN\n원 계획\n');
    await runImplementationPhaseViaSE('m1', mkTask({ title: 'x', criteria: ['a', 'b'] }), {
      armed: true, backend: 'monad-self', log: () => {}, writePlan: () => planPath,
      runOne: async (target) => ({ status: 'built', target, next: 'ok' }) as NocturnalResult,
    });
    expect(readFileSync(planPath, 'utf-8')).not.toContain('사전 레드팀');
  });
});

describe('classifyPhaseKindSmart — LLM 분류 + regex fallback + 캐시(대표 2026-07-13)', () => {
  it('LLM operational → operational (조사 서브페이즈·정규식 안 잡혀도)', async () => {
    const t = mkTask({ title: '리플레이 데이터와 기존 주입 경계를 조사하라', description: 'src/domains/finance-tools.ts 를 읽고 경계를 대조한다.' });
    expect(await classifyPhaseKindSmart(t, { llm: async () => 'operational', noCache: true })).toBe('operational');
  });
  it('LLM implementation → implementation', async () => {
    expect(await classifyPhaseKindSmart(mkTask({ title: '판정 함수 추가' }), { llm: async () => 'implementation', noCache: true })).toBe('implementation');
  });
  it('LLM 실패(throw) → 정규식 fallback', async () => {
    const t = mkTask({ title: '조사 전용 단계다', description: '조사 전용' });
    expect(await classifyPhaseKindSmart(t, { llm: async () => { throw new Error('llm down'); }, noCache: true })).toBe('operational');
  });
  it('LLM 불확실(빈 답) → 정규식 fallback', async () => {
    const t = mkTask({ title: '가격 정책을 구현하라', description: 'src/x.ts 작성' });
    expect(await classifyPhaseKindSmart(t, { llm: async () => 'hmm?', noCache: true })).toBe('implementation');
  });
  it('캐시 — 같은 task.id 두번째 호출은 LLM 안 부름', async () => {
    let calls = 0;
    const t = mkTaskId('task:cache-test', 'Y 구현');
    await classifyPhaseKindSmart(t, { llm: async () => { calls++; return 'operational'; } });
    await classifyPhaseKindSmart(t, { llm: async () => { calls++; return 'implementation'; } });
    expect(calls).toBe(1);
  });
  it('★재료 정제 — 코드파일 경로가 프롬프트에서 <파일>로 중립화(대표 2026-07-20·부적절 컨텍스트 유입)', async () => {
    let captured = '';
    const t = mkTaskId('task:redact', '기존 흡수·채널 재사용 지점을 조사하라');
    t.description = '`src/telegram-commands.ts` 의 dispatcher를 읽기만 하고 `scripts/run-mission.ts`·apps/web/foo.tsx 를 식별한다. 구현 제안은 작성하지 않는다.';
    await classifyPhaseKindSmart(t, { llm: async (p: string) => { captured = p; return 'operational'; }, noCache: true });
    expect(captured).not.toContain('src/telegram-commands.ts'); // 경로 중립화(밀도 오판 차단)
    expect(captured).not.toContain('scripts/run-mission.ts');
    expect(captured).toContain('<파일>');
  });
  it('★프롬프트 강화 — 동사 1차 신호 + 파일 언급≠구현 가이드 주입(대표 2026-07-20)', async () => {
    let captured = '';
    await classifyPhaseKindSmart(mkTaskId('task:prompt', '조사하라'), { llm: async (p: string) => { captured = p; return 'operational'; }, noCache: true });
    expect(captured).toContain('1차 신호=동사');
    expect(captured).toContain('그 자체는 implementation 신호가 아니다');
  });
  it('★divergence 가드 완화(luna tie-breaker·대표 2026-07-22) — tie-breaker=operational 재확답 → 보수 operational', async () => {
    const t = mkTaskId('task:guard', '기존 흡수·채널 재사용 지점을 조사하라');
    t.description = '소스를 읽기만 하고 재사용 지점을 기록한다. 구현 제안은 작성하지 않는다.'; // read-only 증거 + regex=operational
    // 본 분류=implementation(오판)이나 tie-breaker(luna 2차·맥락)가 operational 재확답 → 조사→구현 오라우팅 차단 유지.
    const llm = async (p: string) => p.includes('전체 미션·아크 맥락') ? 'operational' : 'implementation';
    expect(await classifyPhaseKindSmart(t, { llm, noCache: true })).toBe('operational');
  });
  it('★divergence 가드 완화 — tie-breaker=implementation 재확답 → implementation 유지(배선 등 진짜 구현 페이즈 구제·81b18c 근본)', async () => {
    const t = mkTaskId('task:guard-impl', '확정된 receiver 에 YouTube 흡수 흐름을 배선하라');
    t.description = '기존 심볼 재사용 지점을 기록하며 흐름을 배선한다.'; // read-only 증거로 가드 조건 충족시키되
    // 본 분류·tie-breaker 둘 다 implementation(luna 맥락 판단 = 코드작성) → 종전엔 하드 operational 였으나 이제 유지.
    const llm = async () => 'implementation';
    expect(await classifyPhaseKindSmart(t, { llm, noCache: true })).toBe('implementation');
  });
  it('★divergence 가드 과발동 방지 — regex=implementation 이면 미개입(구현 페이즈는 그대로)', async () => {
    const t = mkTaskId('task:guard-neg', '가격 정책 함수를 구현하라');
    t.description = 'src/pricing.ts 에 판정 함수를 작성한다.'; // regex=implementation
    expect(await classifyPhaseKindSmart(t, { llm: async () => 'implementation', noCache: true })).toBe('implementation');
  });
});
