import { describe, it, expect } from 'bun:test';
import { autoPresentReviseCard, type AutoReviseDeps } from './mission-auto-revise.js';
import type { ReviseRecommendation } from './mission-revise-recommender.js';
import type { MissionOrigin } from './mission-origin.js';

const REC: ReviseRecommendation = {
  shouldRevise: true, reviseKind: 'revise-scope', comment: '타입 구조만 정의하고 런타임 검증은 후속 페이즈로 분리하라',
  confidence: 'high', rationale: '구현자-검증자 교착 — 범위 과대', source: 'llm',
};

function harness(over: Partial<AutoReviseDeps> = {}, origin: MissionOrigin | null = { channel: 'telegram', chatId: 111, threadId: 7, botId: 'bot' }) {
  const saved: unknown[] = [];
  const memos: unknown[] = [];
  const cards: Array<{ text: string; buttons: unknown[] }> = [];
  const deps: AutoReviseDeps = {
    loadOrigin: () => origin,
    recommend: async () => REC,
    savePending: ((_id, d) => { saved.push(d); }) as AutoReviseDeps['savePending'],
    appendMemory: ((_id, e) => { memos.push(e); }) as AutoReviseDeps['appendMemory'],
    sendCard: (_o, text, buttons) => { cards.push({ text, buttons }); return true; },
    ...over,
  };
  return { deps, saved, memos, cards };
}

describe('autoPresentReviseCard — 교착 자율 revise 결선', () => {
  it('추천이 있으면 pending 저장 + 자각 기록 + 카드 발송', async () => {
    const { deps, saved, memos, cards } = harness();
    const r = await autoPresentReviseCard('apm_x', '교착 근거: opus 3회 no-op', deps);
    expect(r.sent).toBe(true);
    expect(r.reason).toBe('card-sent');
    expect(r.reviseKind).toBe('revise-scope');
    expect(saved).toHaveLength(1);
    expect(memos).toHaveLength(1);
    expect(cards).toHaveLength(1);
    // 카드에 자율 판단 힌트 + 승인 버튼
    expect(cards[0]!.text).toContain('자율 판단');
    expect(cards[0]!.text).toContain('교착');
    expect(cards[0]!.buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('provenance=self 로 자각 기록한다(외부 지시 아님)', async () => {
    const { deps, memos } = harness();
    await autoPresentReviseCard('apm_x', 'ctx', deps);
    expect((memos[0] as Record<string, unknown>).provenance).toBe('self');
  });

  it('origin 이 없으면 미발송(호출측이 rerun 폴백) — 저장/카드 없음', async () => {
    const { deps, saved, cards } = harness({}, null);
    const r = await autoPresentReviseCard('apm_x', 'ctx', deps);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('no-origin');
    expect(saved).toHaveLength(0);
    expect(cards).toHaveLength(0);
  });

  it('chatId 없는 origin 도 no-origin', async () => {
    const { deps } = harness({}, { channel: 'telegram', botId: 'b' });
    const r = await autoPresentReviseCard('apm_x', 'ctx', deps);
    expect(r.reason).toBe('no-origin');
  });

  it('추천이 shouldRevise=false 면 미발송(no-recommendation)', async () => {
    const { deps, cards } = harness({ recommend: async () => ({ ...REC, shouldRevise: false }) });
    const r = await autoPresentReviseCard('apm_x', 'ctx', deps);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('no-recommendation');
    expect(cards).toHaveLength(0);
  });

  it('추천 comment 가 비면 미발송', async () => {
    const { deps } = harness({ recommend: async () => ({ ...REC, comment: '  ' }) });
    const r = await autoPresentReviseCard('apm_x', 'ctx', deps);
    expect(r.reason).toBe('no-recommendation');
  });

  it('추천이 던져도 fail-soft (no-recommendation)', async () => {
    const { deps } = harness({ recommend: async () => { throw new Error('llm boom'); } });
    const r = await autoPresentReviseCard('apm_x', 'ctx', deps);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('no-recommendation');
  });

  it('발송 sink 가 false 면 send-failed (초안은 저장됨)', async () => {
    const { deps, saved } = harness({ sendCard: () => false });
    const r = await autoPresentReviseCard('apm_x', 'ctx', deps);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('send-failed');
    expect(saved).toHaveLength(1); // 초안 보관은 됨(사람이 나중에 조회 가능)
  });

  it('failureContext 가 recommend 에 userContext 로 전달된다', async () => {
    let captured = '';
    const { deps } = harness({ recommend: async (_id, ctx) => { captured = ctx; return REC; } });
    await autoPresentReviseCard('apm_x', '교착 근거: validate 없음·opus no-op 3회', deps);
    expect(captured).toContain('validate 없음');
  });
});
