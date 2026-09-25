import { describe, it, expect } from 'bun:test';
import { buildArcReviseContext, presentArcReviseCard, type ArcFailure } from './mission-arc-revise.js';
import type { AutoReviseDeps } from './mission-auto-revise.js';
import type { ReviseRecommendation } from './mission-revise-recommender.js';
import type { MissionOrigin } from './mission-origin.js';

const ARC: ArcFailure = {
  arcId: 'arc_관측계약_0', name: '관측 계약', intent: '포지션·국면을 coordinator 수명주기에 연결해 관측한다',
  missing: 'observeCoordinatorState 가 export만·lifecycle 미배선(dead-code)',
};

const REC: ReviseRecommendation = {
  shouldRevise: true, reviseKind: 'revise-scope', comment: 'observe를 createCoordinatorMission에 배선하고 통합 테스트 추가',
  confidence: 'high', rationale: '아크 통합 미충족', source: 'llm',
};

describe('buildArcReviseContext — 아크 통합 실패 → revise userContext', () => {
  it('아크 이름·의도·미충족을 담는다', () => {
    const ctx = buildArcReviseContext(ARC);
    expect(ctx).toContain('관측 계약');
    expect(ctx).toContain('dead-code');
    expect(ctx).toContain('통합 정합성');
    expect(ctx).toContain('반복하지 마라');
  });
});

describe('presentArcReviseCard — P3 재사용 + 아크 힌트', () => {
  function harness(over: Partial<AutoReviseDeps> = {}, origin: MissionOrigin | null = { channel: 'telegram', chatId: 1, botId: 'b' }) {
    const cards: Array<{ text: string; buttons: unknown[] }> = [];
    let capturedCtx = '';
    const deps: AutoReviseDeps = {
      loadOrigin: () => origin,
      recommend: async (_id, ctx) => { capturedCtx = ctx; return REC; },
      savePending: (() => {}) as AutoReviseDeps['savePending'],
      appendMemory: (() => {}) as AutoReviseDeps['appendMemory'],
      sendCard: (_o, text, buttons) => { cards.push({ text, buttons }); return true; },
      ...over,
    };
    return { deps, cards, getCtx: () => capturedCtx };
  }

  it('아크 통합 실패 → 카드 발송(아크 힌트 포함)', async () => {
    const { deps, cards } = harness();
    const r = await presentArcReviseCard('apm_x', ARC, deps);
    expect(r.sent).toBe(true);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.text).toContain('아크 통합 검증 실패');
    expect(cards[0]!.text).toContain('관측 계약');
  });

  it('아크 컨텍스트가 recommend 에 userContext 로 전달된다', async () => {
    const { deps, getCtx } = harness();
    await presentArcReviseCard('apm_x', ARC, deps);
    expect(getCtx()).toContain('아크 통합 검증 실패');
    expect(getCtx()).toContain('observeCoordinatorState');
  });

  it('origin 없으면 미발송(호출측 rerun 폴백)', async () => {
    const { deps, cards } = harness({}, null);
    const r = await presentArcReviseCard('apm_x', ARC, deps);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('no-origin');
    expect(cards).toHaveLength(0);
  });
});
