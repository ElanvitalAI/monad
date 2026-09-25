import { describe, it, expect } from 'bun:test';
import {
  createStubNextActionSource,
  createMissionNextActionSource,
  type NextActionContext,
  type PhaseActionState,
} from './next-action-source.js';

const ctx = (over: Partial<NextActionContext> = {}): NextActionContext => ({
  refId: 'task:p1', refKind: 'task', finishedSurface: null, outcome: 'ok', retroSummary: '', tags: [], ...over,
});
const state = (over: Partial<PhaseActionState> = {}): PhaseActionState => ({
  isMissionPhase: true, status: 'done', hasPr: false, missionCompleted: false, hasCritique: false, ...over,
});

describe('createMissionNextActionSource — mission-fabric 액션 후보', () => {
  it('failed 페이즈 → rebuild/split/revise/skip/escalate(triage 어휘)', async () => {
    const src = createMissionNextActionSource({ lookupPhase: () => state({ status: 'failed' }) });
    const out = await src.top(ctx({ outcome: 'failed' }), 5);
    expect(out.map((c) => c.kind)).toEqual(['rebuild', 'split', 'revise', 'skip', 'escalate']);
    expect(out[0]!.score).toBeGreaterThan(out[4]!.score); // rebuild 최우선
  });
  it('done + PR + 비평지적 → rebuild(재반영)/check(사람확인)', async () => {
    const src = createMissionNextActionSource({ lookupPhase: () => state({ status: 'done', hasPr: true, hasCritique: true }) });
    const out = await src.top(ctx({ outcome: 'ok' }), 5);
    expect(out.map((c) => c.kind)).toContain('rebuild'); // 비평 재반영
    expect(out.map((c) => c.kind)).toContain('check');
  });
  it('done·PR 없음·지적 없음 → 후보 0(칩 안 뜸)', async () => {
    const src = createMissionNextActionSource({ lookupPhase: () => state({ status: 'done' }) });
    expect(await src.top(ctx(), 5)).toHaveLength(0);
  });
  it('미션 페이즈 아니면 → 0(mission-fabric 무관)', async () => {
    const src = createMissionNextActionSource({ lookupPhase: () => state({ isMissionPhase: false }) });
    expect(await src.top(ctx(), 5)).toHaveLength(0);
  });
  it('lookupPhase null(미조회) → 0', async () => {
    const src = createMissionNextActionSource({ lookupPhase: () => null });
    expect(await src.top(ctx(), 5)).toHaveLength(0);
  });
  it('lookupPhase throw → 0(fail-soft)', async () => {
    const src = createMissionNextActionSource({ lookupPhase: () => { throw new Error('db'); } });
    expect(await src.top(ctx(), 5)).toHaveLength(0);
  });
  it('limit 준수', async () => {
    const src = createMissionNextActionSource({ lookupPhase: () => state({ status: 'failed' }) });
    expect(await src.top(ctx({ outcome: 'failed' }), 2)).toHaveLength(2);
  });
});

describe('createStubNextActionSource — refId 추가 후 하위호환', () => {
  it('outcome=ok → continue-similar-task 포함(기존 규칙 유지)', async () => {
    const out = await createStubNextActionSource().top(ctx({ outcome: 'ok' }), 5);
    expect(out.map((c) => c.kind)).toContain('continue-similar-task');
  });
});
