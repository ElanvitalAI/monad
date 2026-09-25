import { describe, it, expect } from 'bun:test';
import {
  decideReplayRewind, replayRewindPrompt, parseReplayJson, MIN_RECURRENCE_FOR_REWIND,
  type ReplayDecisionInput, type ReplayContext, type RawReplayDecision,
} from './mission-replay-decision.js';

const input: ReplayDecisionInput = {
  stuckPhaseId: 'p12', stuckTitle: 'digest 계약 확정', stuckIndex: 12, recurrence: 3,
  candidates: [
    { phaseId: 'p3', title: 'saveKnowledgeNote 계약', index: 3 },
    { phaseId: 'p13', title: 'downstream', index: 13 }, // downstream(무효 후보)
  ],
};
const ctx: ReplayContext = { goal: '콘텐츠 소화', failureSummary: 'digest 계약이 vault 계약 전제와 어긋남' };
const stub = (r: RawReplayDecision): (() => Promise<RawReplayDecision>) => () => Promise.resolve(r);

describe('decideReplayRewind — 순수 브레인(P5d)', () => {
  it('반복 < 임계 → no-rewind(프리매처 되감기 방지)', async () => {
    const r = await decideReplayRewind({ ...input, recurrence: 1 }, ctx, stub({ action: 'rewind-to', targetPhaseId: 'p3' }));
    expect(r.action).toBe('no-rewind');
  });

  it('upstream 후보 없음 → no-rewind', async () => {
    const r = await decideReplayRewind({ ...input, candidates: [{ phaseId: 'p13', title: 'd', index: 13 }] }, ctx, stub({ action: 'rewind-to', targetPhaseId: 'p13' }));
    expect(r.action).toBe('no-rewind');
  });

  it('명확한 upstream 귀인 → rewind-to(upstream 후보)', async () => {
    const r = await decideReplayRewind(input, ctx, stub({ action: 'rewind-to', targetPhaseId: 'p3', reason: 'vault 계약 결함' }));
    expect(r.action).toBe('rewind-to');
    expect(r.targetPhaseId).toBe('p3');
  });

  it('target 이 downstream(무효 후보) → no-rewind(진행분 폐기 방지)', async () => {
    const r = await decideReplayRewind(input, ctx, stub({ action: 'rewind-to', targetPhaseId: 'p13' }));
    expect(r.action).toBe('no-rewind'); // p13 은 index>stuck 이라 upstream 아님
  });

  it('target 이 존재하지 않는 id → no-rewind', async () => {
    expect((await decideReplayRewind(input, ctx, stub({ action: 'rewind-to', targetPhaseId: 'pX' }))).action).toBe('no-rewind');
  });

  it('LLM no-rewind → no-rewind', async () => {
    expect((await decideReplayRewind(input, ctx, stub({ action: 'no-rewind', reason: '이 페이즈 자체 문제' }))).action).toBe('no-rewind');
  });

  it('LLM 예외 → no-rewind(fail-soft)', async () => {
    const r = await decideReplayRewind(input, ctx, () => Promise.reject(new Error('down')));
    expect(r.action).toBe('no-rewind');
    expect(r.reason).toContain('fail-soft');
  });

  it('MIN_RECURRENCE_FOR_REWIND 은 3', () => expect(MIN_RECURRENCE_FOR_REWIND).toBe(3));
});

describe('parseReplayJson · replayRewindPrompt', () => {
  it('JSON 파싱', () => {
    expect(parseReplayJson('```json\n{"action":"rewind-to","targetPhaseId":"p3","reason":"r"}\n```')).toEqual({ action: 'rewind-to', targetPhaseId: 'p3', reason: 'r' });
  });
  it('JSON 아니면 빈 객체(→no-rewind)', () => expect(parseReplayJson('nope')).toEqual({}));
  it('프롬프트 — upstream 후보만·보수적 지시', () => {
    const p = replayRewindPrompt(input, ctx);
    expect(p).toContain('id=p3'); // upstream
    expect(p).not.toContain('id=p13'); // downstream 제외
    expect(p).toContain('보수적');
  });
});
