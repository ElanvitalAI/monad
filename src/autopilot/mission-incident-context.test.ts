import { describe, it, expect } from 'bun:test';
import { buildMissionIncidentContext, formatIncidentContext } from './mission-incident-context.js';
import type { OpsMissionDetail } from '../domains/ops-status.js';
import type { PhaseAttemptFact } from './se-build-registry.js';

const NOW = '2026-07-15T18:30:00.000Z';
const now = () => NOW;

function detail(over: Partial<OpsMissionDetail> = {}): OpsMissionDetail {
  return {
    mission: { id: 'm1', goal: '야간 DocOps 큐레이션', status: 'running', source: 'human-intent', disposition: 'running', executionModel: 'task', tier: 'heavy', engine: 'tox', rationale: null, materializeSpec: null, createdAt: '', updatedAt: '' },
    derived: [], rollup: { total: 0, ok: 0, stale: 0, error: 0, active: 0, pending: 0 },
    transitions: [], phases: [], runLogPath: null, planDraft: null, note: '',
    ...over,
  };
}

describe('buildMissionIncidentContext (결정론·재사용)', () => {
  it('미션 부재 → found=false(봇 추측 금지)', () => {
    const ctx = buildMissionIncidentContext('nope', { detail: () => detail({ mission: null }), attempts: () => [], now });
    expect(ctx.found).toBe(false);
    expect(ctx.phases).toHaveLength(0);
  });

  it('detail 던지면 degraded found=false(fail-soft)', () => {
    const ctx = buildMissionIncidentContext('m1', { detail: () => { throw new Error('db down'); }, attempts: () => [], now });
    expect(ctx.found).toBe(false);
    expect(ctx.degraded).toBe(true);
  });

  it('실패 페이즈만 시도 트레일 조회(done 은 스킵·비용 bound)', () => {
    const attemptCalls: string[] = [];
    const attempts = (id: string): PhaseAttemptFact[] => {
      attemptCalls.push(id);
      return [{ backend: 'monad-self:gpt-5.6-terra', gateResult: 'gate-failed', gateOutputExcerpt: '순환 자기테스트' }, { backend: 'monad-self:claude-opus-4-8', gateResult: 'no-change' }];
    };
    const ctx = buildMissionIncidentContext('m1', {
      detail: () => detail({ phases: [
        { index: 0, id: 'p0', title: '조사', status: 'done' },
        { index: 1, id: 'p1', title: '회귀테스트', status: 'failed', failClass: 'gate-failed-critique', diagnosis: { narrative: '', rootCause: '자기테스트', heal: 'revise', confidence: 'high' }, prUrl: 'https://github.com/x/y/pull/4290' },
      ] }),
      attempts, now,
    });
    expect(ctx.found).toBe(true);
    expect(ctx.state).toMatchObject({ total: 2, done: 1, failed: 1 });
    // done 페이즈는 attempts 미조회, failed 페이즈만 조회
    expect(attemptCalls).toEqual(['p1']);
    expect(ctx.phases[1]!.attempts.map((a) => a.gateResult)).toEqual(['gate-failed', 'no-change']);
    expect(ctx.phases[1]!.rootCause).toBe('자기테스트');
    expect(ctx.phases[1]!.heal).toBe('revise');
  });

  it('deliverables = 이 미션 페이즈 PR 만(외부 PR 차단)', () => {
    const ctx = buildMissionIncidentContext('m1', {
      detail: () => detail({ phases: [
        { index: 0, id: 'p0', title: '조사', status: 'done', prUrl: 'https://github.com/x/y/pull/4291' },
        { index: 1, id: 'p1', title: '테스트', status: 'skipped' },
      ] }),
      attempts: () => [], now,
    });
    expect(ctx.deliverables).toEqual([{ prUrl: 'https://github.com/x/y/pull/4291', phase: '조사' }]);
  });
});

describe('formatIncidentContext (anti-confabulation)', () => {
  it('found 이면 사건 사실 + 지어내기 금지 규칙 포함', () => {
    const ctx = buildMissionIncidentContext('m1', {
      detail: () => detail({ phases: [
        { index: 1, id: 'p1', title: '회귀테스트', status: 'failed', failClass: 'gate-failed-critique', diagnosis: { narrative: '', rootCause: '자기테스트 검증', heal: 'revise', confidence: 'high' } },
      ] }),
      attempts: () => [{ backend: 'monad-self:gpt-5.6-terra', gateResult: 'gate-failed' }], now,
    });
    const s = formatIncidentContext(ctx);
    expect(s).toContain('이 팩의 사실로만 답하라');
    expect(s).toContain('gate-failed-critique');
    expect(s).toContain('terra(gate-failed)');
    expect(s).toContain('지어내지 말 것');
    expect(s).toContain('산출 PR(이 미션 소속만): 없음'); // 외부 PR confabulation 차단 실증
  });

  it('not-found 이면 "기록 없음"·추측 금지 안내', () => {
    const ctx = buildMissionIncidentContext('nope', { detail: () => detail({ mission: null }), attempts: () => [], now });
    const s = formatIncidentContext(ctx);
    expect(s).toContain('기록을 찾지 못함');
    expect(s).toContain('추측');
    expect(s).not.toContain('pull/'); // 지어낸 PR 참조 없음
    expect(s).not.toMatch(/#\d/); // 지어낸 PR 번호(#3928 류) 없음
  });
});
