// 스몰-폼 하니스 시퀀서(H0) — P→E→R→D·divergence 캡·autoDrive·채널 상태·progress-ledger 검증.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStagedHarness, HARNESS_STAGE_MAP, type StagedHarnessSeams, type ReviewVerdict } from './staged-harness.js';
import { readHarnessScreen } from './harness-screen.js';
import { HARNESS_SPACE_ENV, HARNESS_SPACE_ID_ENV } from './harness-space.js';
import { debug } from '../debug/log.js';

/** 시나리오별 fake seam 빌더. */
function seams(over: Partial<StagedHarnessSeams> = {}): StagedHarnessSeams {
  return {
    async plan() { return { steps: ['s1', 's2'] }; },
    async execute() { return { ok: true, summary: '구현됨', changes: ['file.ts'] }; },
    async review(): Promise<ReviewVerdict> { return { verdict: 'pass', findings: [] }; },
    async deploy() { return { ok: true, ref: 'PR#1' }; },
    ...over,
  };
}

describe('HARNESS_STAGE_MAP — 자기서술 메타(Q2·harness map SSOT)', () => {
  test('order 는 0..N 연속·시퀀서 실행순서와 일치', () => {
    const orders = HARNESS_STAGE_MAP.map((s) => s.order);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5]);
    expect(HARNESS_STAGE_MAP.map((s) => s.stage)).toEqual(['clarify', 'research', 'plan', 'execute', 'review', 'deploy']);
  });
  test('필수 스테이지(plan/execute/review/deploy)=optional false·front(clarify/research)=opt-in', () => {
    const byStage = Object.fromEntries(HARNESS_STAGE_MAP.map((s) => [s.stage, s.optional]));
    expect(byStage.plan).toBe(false);
    expect(byStage.execute).toBe(false);
    expect(byStage.review).toBe(false);
    expect(byStage.deploy).toBe(false);
    expect(byStage.clarify).toBe(true);
    expect(byStage.research).toBe(true);
  });
  test('모든 엔트리가 비어있지 않은 role 서술을 가짐', () => {
    for (const s of HARNESS_STAGE_MAP) expect(s.role.trim().length).toBeGreaterThan(0);
  });
});

describe('runStagedHarness — 정상 경로', () => {
  test('P→E→R(pass)→D → deployed', async () => {
    const r = await runStagedHarness({ objective: '기능 X 구현', seams: seams() });
    expect(r.ok).toBe(true);
    expect(r.terminal).toBe('pr-opened');
    expect(r.rounds).toBe(1);
    expect(r.deployRef).toBe('PR#1');
    // 채널 상태 — plan lastValue·changes append·verdict lastValue
    expect(r.state.plan).toBeDefined();
    expect(r.state.changes).toEqual(['file.ts']);
    expect((r.state.verdict as ReviewVerdict).verdict).toBe('pass');
  });

  test('review warn → 그래도 deploy', async () => {
    const r = await runStagedHarness({ objective: 'x', seams: seams({ async review() { return { verdict: 'warn', findings: ['nit'] }; } }) });
    expect(r.terminal).toBe('pr-opened');
  });
});

describe('runStagedHarness — non-code terminal proof', () => {
  test('증거 없는 published와 검증된 published를 terminal 관측으로 구별한다', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    try {
      (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
        events.push({ event, data: (data ?? {}) as Record<string, unknown> });
      }) as typeof debug.log;
      const unproven = await runStagedHarness({
        objective: '코드 변경 골',
        seams: seams({ async deploy() { return { ok: true, kind: 'published', changes: [] }; } }),
      });
      const verified = await runStagedHarness({
        objective: '웹 게시 골',
        seams: seams({ async deploy() { return { ok: true, kind: 'published', ref: 'https://example.test', changes: [], nonCodeEvidence: 'published-url' }; } }),
      });
      expect(unproven).toMatchObject({ ok: false, terminal: 'no-changes' });
      expect(verified).toMatchObject({ ok: true, terminal: 'published' });
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    const deployed = events.filter((entry) => entry.event === 'deployed').map((entry) => entry.data);
    const terminals = events.filter((entry) => entry.event === 'terminal').map((entry) => entry.data);
    expect(deployed).toContainEqual(expect.objectContaining({ kind: 'published', changes: 0, nonCodeEvidence: null, nonCodeVerified: false }));
    expect(deployed).toContainEqual(expect.objectContaining({ kind: 'published', changes: 0, nonCodeEvidence: 'published-url', nonCodeVerified: true }));
    expect(terminals).toContainEqual(expect.objectContaining({ terminal: 'no-changes', changes: 0, nonCodeEvidence: null, nonCodeVerified: false }));
    expect(terminals).toContainEqual(expect.objectContaining({ terminal: 'published', changes: 0, nonCodeEvidence: 'published-url', nonCodeVerified: true }));
  });

  test('증거 없는 signaled는 성공 종단을 우회하지 않는다', async () => {
    const result = await runStagedHarness({
      objective: '신호 골',
      seams: seams({ async deploy() { return { ok: true, kind: 'signaled', ref: 'signal#1', changes: [] }; } }),
    });
    expect(result).toMatchObject({ ok: false, terminal: 'no-changes' });
  });

  test('검증된 executed는 공용 증거 계약으로 성공 종단을 유지한다', async () => {
    const result = await runStagedHarness({
      objective: '집행 골',
      seams: seams({ async deploy() { return { ok: true, kind: 'executed', ref: 'execution#1', changes: [], nonCodeEvidence: 'execution-completed' }; } }),
    });
    expect(result).toMatchObject({ ok: true, terminal: 'executed' });
  });
});

describe('runStagedHarness — stopAfter plan', () => {
  test("stopAfter 'plan' → 계획만 반환하고 execute/review/deploy를 호출하지 않으며 관측한다", async () => {
    const logs: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((category, event, data) => {
      logs.push({ category, event, data: (data ?? {}) as Record<string, unknown> });
    }) as typeof debug.log;
    try {
      const r = await runStagedHarness({
        objective: '계획만 확인',
        runId: 'plan-only-run',
        stopAfter: 'plan',
        seams: seams({
          async plan() { return { steps: ['첫 단계', '둘째 단계'] }; },
          async execute() { throw new Error('execute seam must not be called'); },
          async review() { throw new Error('review seam must not be called'); },
          async deploy() { throw new Error('deploy seam must not be called'); },
        }),
      });
      expect(r.ok).toBe(true);
      expect(r.terminal).toBe('plan-only');
      expect(r.rounds).toBe(0);
      expect((r.state.plan as { steps: string[] }).steps).toEqual(['첫 단계', '둘째 단계']);
      expect(logs).toContainEqual({
        category: 'staged-harness',
        event: 'stop-after-plan',
        data: { runId: 'plan-only-run', steps: 2 },
      });
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
  });
});

describe('runStagedHarness — reviewed artifact observation', () => {
  test('심사 미실행 warn은 reviewed와 성공 종결 관측에서 구분된다', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    try {
      (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
        events.push({ event, data: (data ?? {}) as Record<string, unknown> });
      }) as typeof debug.log;
      const result = await runStagedHarness({
        objective: 'empty diff run',
        seams: seams({ async review() { return { verdict: 'warn', findings: ['자율 PR 리뷰 미실행(fail-soft) — 미검토'], reviewed: false }; } }),
      });
      expect(result.ok).toBe(true);
      expect(result.verdict).toMatchObject({ verdict: 'warn', reviewed: false });
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    expect(events.find((entry) => entry.event === 'reviewed')!.data).toMatchObject({ verdict: 'warn', reviewed: false });
    expect(events.find((entry) => entry.event === 'terminal')!.data).toMatchObject({ terminal: 'pr-opened', reviewed: false, reviewExecuted: false });
  });

  test('terminal 원장은 review 실행 true·false·정보 부재를 상시 구분한다', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    try {
      (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
        events.push({ event, data: (data ?? {}) as Record<string, unknown> });
      }) as typeof debug.log;
      const reviewed = await runStagedHarness({
        objective: 'reviewed run',
        seams: seams({ async review() { return { verdict: 'pass', findings: [], reviewed: true }; } }),
      });
      const unreviewed = await runStagedHarness({
        objective: 'unreviewed run',
        seams: seams({ async review() { return { verdict: 'warn', findings: [], reviewed: false }; } }),
      });
      const unknown = await runStagedHarness({
        objective: 'unknown review run',
        seams: seams({ async review() { return { verdict: 'pass', findings: [] }; } }),
      });
      expect(reviewed).toMatchObject({ ok: true, terminal: 'pr-opened' });
      expect(unreviewed).toMatchObject({ ok: true, terminal: 'pr-opened' });
      expect(unknown).toMatchObject({ ok: true, terminal: 'pr-opened' });
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    const terminals = events.filter((entry) => entry.event === 'terminal').map((entry) => entry.data);
    expect(terminals).toContainEqual(expect.objectContaining({ terminal: 'pr-opened', reviewExecuted: true, reviewed: true, nonCodeVerified: false }));
    expect(terminals).toContainEqual(expect.objectContaining({ terminal: 'pr-opened', reviewExecuted: false, reviewed: false, nonCodeVerified: false }));
    const unknown = terminals.find((entry) => entry.reviewExecuted === null)!;
    expect(unknown).toMatchObject({ terminal: 'pr-opened', reviewExecuted: null, nonCodeVerified: false });
    expect(Object.hasOwn(unknown, 'reviewed')).toBe(false);
  });

  // ⛔ 리뷰 should-fix 수리(2026-08-11 · `[T]`): 종전 검사가 `pr-opened` 분기만 봐서
  //    ***조기 반환 둘(`no-changes`·`deploy-failed`)이 이 칸을 안 실어도 통과***했다.
  //    수용 기준이 「항상」이므로 그 두 분기를 직접 문다.
  test('조기 반환 종단(no-changes·deploy-failed)도 reviewExecuted 를 싣는다', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    try {
      (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
        events.push({ event, data: (data ?? {}) as Record<string, unknown> });
      }) as typeof debug.log;
      await runStagedHarness({
        objective: 'no-changes run',
        seams: seams({
          async review(): Promise<ReviewVerdict> { return { verdict: 'pass', findings: [], reviewed: true }; },
          async deploy() { return { ok: true, kind: 'none' }; },
        }),
      });
      await runStagedHarness({
        objective: 'deploy-failed run',
        seams: seams({
          async review(): Promise<ReviewVerdict> { return { verdict: 'warn', findings: [], reviewed: false }; },
          async deploy() { return { ok: false, kind: 'pr' }; },
        }),
      });
      await runStagedHarness({
        objective: 'deploy-failed without review info',
        seams: seams({
          async review(): Promise<ReviewVerdict> { return { verdict: 'pass', findings: [] }; },
          async deploy() { return { ok: false, kind: 'pr' }; },
        }),
      });
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    const terminals = events.filter((entry) => entry.event === 'terminal').map((entry) => entry.data);
    expect(terminals).toContainEqual(expect.objectContaining({ terminal: 'no-changes', reviewExecuted: true }));
    expect(terminals).toContainEqual(expect.objectContaining({ terminal: 'deploy-failed', reviewExecuted: false }));
    // 삼상태의 셋째 — 「모른다」도 «칸이 있고» 앞의 둘과 다른 값이다.
    const unknown = terminals.find((entry) => entry.terminal === 'deploy-failed' && entry.reviewExecuted === null);
    expect(unknown).toBeDefined();
    // ⛔ 「칸이 없다」와 「null 이다」를 가른다 — 전부 그 칸을 «갖고» 있어야 한다.
    for (const entry of terminals) expect(Object.hasOwn(entry, 'reviewExecuted')).toBe(true);
  });

  test('findings 원문은 지속 artifact에 넘기고 reviewed 로그에는 포인터만 남긴다', async () => {
    const longFinding = `보존해야 하는 하니스 지적 ${'내용 '.repeat(90)}`;
    const artifacts: unknown[] = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const original = (await import('../debug/log.js')).debug.log;
    try {
      (await import('../debug/log.js')).debug.log = ((_category, event, data) => {
        events.push({ event, data: data as Record<string, unknown> });
      }) as typeof original;
      await runStagedHarness({
        objective: 'persist harness review',
        seams: seams({
          async review() { return { verdict: 'warn', findings: [longFinding], mustFix: [longFinding] }; },
          persistReviewArtifact: (input) => { artifacts.push(input); return { path: '/artifacts/harness-review.json' }; },
        }),
      });
    } finally {
      (await import('../debug/log.js')).debug.log = original;
    }
    expect(artifacts).toEqual([expect.objectContaining({ findings: [longFinding], mustFix: [longFinding] })]);
    const reviewed = events.find((entry) => entry.event === 'reviewed')!.data;
    expect(reviewed).toMatchObject({ findings: 1, artifactPath: '/artifacts/harness-review.json' });
    expect(JSON.stringify(reviewed)).not.toContain(longFinding);
    expect(JSON.stringify(reviewed).length).toBeLessThan(200);
  });
});

describe('runStagedHarness — R1 Research 스테이지(front)', () => {
  test('research seam → corpus 가 plan objective 앞에 얹힘(재조사 억제·원 objective 보존)', async () => {
    let planObjective = '';
    const r = await runStagedHarness({
      objective: '삼성전자 리서치',
      seams: seams({
        research: async () => ({ corpus: '시장 데이터: PER 15·외국인 순매수' }),
        async plan(ctx) { planObjective = ctx.objective; return { steps: ['s'] }; },
      }),
    });
    expect(planObjective).toContain('[사전 조사 corpus');
    expect(planObjective).toContain('PER 15');
    expect(planObjective).toContain('삼성전자 리서치');
    expect(r.terminal).toBe('pr-opened');
  });

  test('research 미주입 → 스킵(무회귀·objective 무변)', async () => {
    let planObjective = '';
    await runStagedHarness({ objective: '코드 골', seams: seams({ async plan(ctx) { planObjective = ctx.objective; return { steps: ['s'] }; } }) });
    expect(planObjective).toBe('코드 골');
  });

  test('research 빈 corpus → objective 무변(fail-soft)', async () => {
    let planObjective = '';
    await runStagedHarness({ objective: 'g', seams: seams({ research: async () => ({ corpus: '' }), async plan(ctx) { planObjective = ctx.objective; return { steps: ['s'] }; } }) });
    expect(planObjective).toBe('g');
  });
});

describe('runStagedHarness — H2 in-loop replan', () => {
  test('divergence + ledger replan → 실패 findings 반영 재계획 후 재시도', async () => {
    const planCalls: Array<{ attempt?: number; findings?: string[] }> = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const pathTokens = Array.from({ length: 21 }, (_, i) => `src/phase-${i + 1}.ts`);
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
      events.push({ event, data: (data ?? {}) as Record<string, unknown> });
    }) as typeof debug.log;
    let r;
    try {
      r = await runStagedHarness({
        objective: '기능 구현', autoDrive: 'on', maxReplans: 1,
        seams: seams({
          async plan(ctx) {
          planCalls.push({ attempt: ctx.attempt, findings: ctx.priorFindings });
          return { steps: [ctx.attempt ? 'src/replanned.ts src/replanned.ts docs/final.md' : pathTokens.join(' '), 'invalid/no-extension'] };
        },
          async review(): Promise<ReviewVerdict> { return { verdict: 'fail', findings: ['블로커 A', '블로커 B'] }; },
        }),
      });
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    // 초기 계획 1 + replan 1 = plan 2회 호출.
    expect(planCalls.length).toBe(2);
    expect(planCalls[0]!.attempt).toBeUndefined();     // 첫 계획엔 attempt 없음
    expect(planCalls[1]!.attempt).toBe(1);             // replan 은 attempt=1(브랜치 suffix)
    expect(planCalls[1]!.findings).toEqual(['블로커 A', '블로커 B']); // 이전 실패 findings 전달
    // 재계획 후에도 계속 fail → divergence(캡 초과) 종료.
    expect(r!.terminal).toBe('review-diverged');
    expect(r!.ledgerRecommendation).toBe('replan');
    const residualEvents = events.filter((entry) => entry.event === 'replan-residual' || entry.event === 'diverged-residual');
    expect(residualEvents.map((entry) => entry.event)).toEqual(['replan-residual', 'diverged-residual']);
    for (const { data } of residualEvents) {
      expect(data).toMatchObject({ remainingSteps: 2, reviewRounds: 2, consecutiveReviewFails: 2 });
      expect(data.investigations).toBeNumber();
    }
    expect(residualEvents[0]!.data).toMatchObject({
      planPathTokens: pathTokens.slice(0, 20),
      planPathTokensTruncated: true,
      planPathTokensTruncatedCount: 1,
    });
    expect(residualEvents[1]!.data).not.toHaveProperty('planPathTokensTruncatedCount');
    expect(residualEvents[0]!.data).toMatchObject({
      investigations: 2,
      planPathTokens: pathTokens.slice(0, 20),
      planPathTokensTruncated: true,
    });
    expect(residualEvents[1]!.data).toMatchObject({
      investigations: 4,
      planPathTokens: ['src/replanned.ts', 'docs/final.md'],
    });
    expect(residualEvents[1]!.data.planPathTokensTruncated).toBeUndefined();
  });

  test('maxReplans=0 → replan 없음(종전 동작·plan 1회)', async () => {
    const planCalls: number[] = [];
    const r = await runStagedHarness({
      objective: 'x', autoDrive: 'on', maxReplans: 0,
      seams: seams({
        async plan(ctx) { planCalls.push(ctx.attempt ?? 0); return { steps: ['s1'] }; },
        async review(): Promise<ReviewVerdict> { return { verdict: 'fail', findings: ['f'] }; },
      }),
    });
    expect(planCalls.length).toBe(1);   // replan 없음
    expect(r.terminal).toBe('review-diverged');
  });
});

describe('runStagedHarness — 실패/divergence 경로', () => {
  test('plan 비면 plan-empty', async () => {
    const r = await runStagedHarness({ objective: 'x', seams: seams({ async plan() { return { steps: [] }; } }) });
    expect(r.ok).toBe(false);
    expect(r.terminal).toBe('plan-empty');
  });

  test('execute 실패 — autoDrive on → 자율 abort(execute-failed)', async () => {
    const r = await runStagedHarness({ objective: 'x', autoDrive: 'on', seams: seams({ async execute() { return { ok: false, summary: '빌드깨짐', changes: [] }; } }) });
    expect(r.terminal).toBe('execute-failed');
  });

  test('execute 실패 — autoDrive safe → escalate(HITL·제1원칙 ②)', async () => {
    const r = await runStagedHarness({ objective: 'x', autoDrive: 'safe', seams: seams({ async execute() { return { ok: false, summary: '빌드깨짐', changes: [] }; } }) });
    expect(r.terminal).toBe('escalated');
  });

  test('rework then pass — 1라운드 fail 후 2라운드 pass → deployed', async () => {
    let n = 0;
    const r = await runStagedHarness({
      objective: 'x',
      seams: seams({ async review() { n++; return n === 1 ? { verdict: 'fail', findings: ['bug'], mustFix: ['fix'] } : { verdict: 'pass', findings: [] }; } }),
    });
    expect(r.terminal).toBe('pr-opened');
    expect(r.rounds).toBe(2);
    // 실패 이력 append(문맥교환 — 다음 라운드 회상)
    expect(Array.isArray(r.state.failures)).toBe(true);
    expect((r.state.failures as unknown[]).length).toBe(1);
  });

  test('review 계속 fail → divergence 캡(maxReviewRounds)', async () => {
    const r = await runStagedHarness({
      objective: 'x', maxReviewRounds: 2, autoDrive: 'safe',
      seams: seams({ async review() { return { verdict: 'fail', findings: ['bug'] }; } }),
    });
    expect(r.ok).toBe(false);
    expect(r.rounds).toBe(2);
    // autoDrive safe → escalated(HITL 필요)
    expect(r.terminal).toBe('escalated');
    expect(r.ledgerRecommendation).toBeDefined();
  });

  test('autoDrive on → divergence 시 escalate 안 하고 review-diverged(자율 종료)', async () => {
    const r = await runStagedHarness({
      objective: 'x', maxReviewRounds: 2, autoDrive: 'on',
      seams: seams({ async review() { return { verdict: 'fail', findings: ['bug'] }; } }),
    });
    expect(r.terminal).toBe('review-diverged');
  });

  test('deploy 실패 → deploy-failed', async () => {
    const r = await runStagedHarness({ objective: 'x', seams: seams({ async deploy() { return { ok: false }; } }) });
    expect(r.terminal).toBe('deploy-failed');
  });

  // ── C4(§8·Waza B) 실패 조사 원장(진단·골루프 우선) ─────────────────────────
  test('C4 — execute 실패 시 조사 원장 첨부(investigations·detail 에 요약)', async () => {
    const r = await runStagedHarness({ objective: 'x', autoDrive: 'on', seams: seams({ async execute() { return { ok: false, summary: '빌드깨짐', changes: [] }; } }) });
    expect(r.investigations?.length).toBe(1);
    expect(r.investigations![0]!.stage).toBe('execute');
    expect(r.investigations![0]!.verdict).toBe('supported');   // 실행-근거로 확인
    expect(r.detail).toContain('실패 조사 원장');
  });

  test('C4 — review divergence 시 라운드마다 조사 기록(원장 누적)', async () => {
    const r = await runStagedHarness({
      objective: 'x', maxReviewRounds: 2, maxReplans: 0, autoDrive: 'on',   // replan 배제 → 결정론 2라운드
      seams: seams({ async review() { return { verdict: 'fail', findings: ['null 체크 누락'] }; } }),
    });
    expect(r.terminal).toBe('review-diverged');
    expect(r.investigations!.length).toBe(2);                  // 2라운드 = 2 조사
    expect(r.investigations!.every((i) => i.stage === 'review')).toBe(true);
    expect(r.detail).toContain('null 체크 누락');
  });

  test('C4 — ledgerMode off → 원장 안 씀(골루프 우선·무접촉)', async () => {
    const r = await runStagedHarness({
      objective: 'x', autoDrive: 'on', ledgerMode: 'off',
      seams: seams({ async execute() { return { ok: false, summary: '깨짐', changes: [] }; } }),
    });
    expect(r.investigations).toBeUndefined();
    expect(r.terminal).toBe('execute-failed');                 // 제어 흐름은 종전 그대로
  });

  test('C4 — 원장은 제어 흐름을 바꾸지 않는다(정상 경로 무영향)', async () => {
    const r = await runStagedHarness({ objective: 'x', seams: seams() });
    expect(r.terminal).toBe('pr-opened');
    expect(r.investigations).toBeUndefined();                  // 실패 없으면 원장 비어 미첨부
  });
});

describe('runStagedHarness — 화면 버퍼 스테이지 경계', () => {
  test('Clarify와 Plan 진입 프레임이 Execute 전에 공간 버퍼에 기록된다', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'staged-screen-'));
    const priorSpace = process.env[HARNESS_SPACE_ENV];
    const priorId = process.env[HARNESS_SPACE_ID_ENV];
    const priorStateDir = process.env.ELANOUS_STATE_DIR;
    process.env[HARNESS_SPACE_ENV] = 'self-implement';
    process.env[HARNESS_SPACE_ID_ENV] = 'clarify-plan-screen';
    process.env.ELANOUS_STATE_DIR = stateDir;
    const frames: string[] = [];
    try {
      await runStagedHarness({
        objective: '화면 프레임 검사',
        seams: seams({
          async clarify() {
            frames.push(readHarnessScreen('clarify-plan-screen') ?? '');
            return { refinedObjective: '화면 프레임 검사', asked: 0 };
          },
          async plan() {
            frames.push(readHarnessScreen('clarify-plan-screen') ?? '');
            return { steps: ['s'] };
          },
        }),
      });
      expect(frames[0]).toContain('[clarify]');
      expect(frames[1]).toContain('[plan]');
    } finally {
      if (priorSpace === undefined) delete process.env[HARNESS_SPACE_ENV]; else process.env[HARNESS_SPACE_ENV] = priorSpace;
      if (priorId === undefined) delete process.env[HARNESS_SPACE_ID_ENV]; else process.env[HARNESS_SPACE_ID_ENV] = priorId;
      if (priorStateDir === undefined) delete process.env.ELANOUS_STATE_DIR; else process.env.ELANOUS_STATE_DIR = priorStateDir;
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe('runStagedHarness — onProgress seam', () => {
  test('각 스테이지 진행 push', async () => {
    const stages: string[] = [];
    await runStagedHarness({ objective: 'x', seams: seams({ onProgress: (ev) => stages.push(ev.stage) }) });
    expect(stages).toContain('plan');
    expect(stages).toContain('execute');
    expect(stages).toContain('review');
    expect(stages).toContain('deploy');
  });
});
