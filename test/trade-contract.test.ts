import { describe, expect, test } from 'bun:test';

import {
  buildLeverageContract,
  buildLeverageContractPrompt,
  LEVERAGE_FOCUS_DEFAULT,
  LEVERAGE_TRIGGER_DEFAULT,
} from '../src/domains/trade-contract.js';
import {
  buildSubmitDecisionTool,
  validateDecision,
} from '../src/domains/trade-decision-tool.js';

describe('buildLeverageContract', () => {
  test('leverage-daytrade defaults: intraday, 5min trigger, focus, tools, review-first', () => {
    const c = buildLeverageContract();
    expect(c.id).toBe('leverage-daytrade');
    expect(c.horizon).toBe('intraday');
    // 대표 지시: 장중 5분 주기.
    expect(c.trigger).toBe(LEVERAGE_TRIGGER_DEFAULT);
    expect(c.trigger).toBe('*/5 9-15 * * 1-5');
    expect(c.focusSymbols).toEqual([...LEVERAGE_FOCUS_DEFAULT]);
    expect(c.focusSymbols).toContain('122630.KO');
    expect(c.focusSymbols).toContain('KORU.US');
    // 현물 삼성은 레버리지 계약 밖(캡스톤 슬롯).
    expect(c.focusSymbols).not.toContain('005930.KO');
    expect(c.tools).toContain('finance_kr_flow');
    expect(c.tools).toContain('submit_trade_decision');
    expect(c.reviewMode).toBe('review-first');
    expect(c.maxOrderKrw).toBe(5_000_000);
  });

  test('opts override (maxOrderKrw null = 상한없음)', () => {
    const c = buildLeverageContract({ maxOrderKrw: null, reviewMode: 'autonomous' });
    expect(c.maxOrderKrw).toBeNull();
    expect(c.reviewMode).toBe('autonomous');
  });
});

describe('buildLeverageContractPrompt', () => {
  test('carries focus symbols, discipline, dig protocol, 목표 방출형 + 제안자 안전', () => {
    const p = buildLeverageContractPrompt(buildLeverageContract());
    expect(p).toContain('122630.KO');
    expect(p).toContain('KORU.US');
    expect(p).toContain('ABCDE');             // 레버리지 매뉴얼 규율
    expect(p).toContain('krx-futures');        // 파생 교차확인 프로토콜
    expect(p).toContain('submit_trade_decision');
    expect(p).toContain('목표 방출형');
    expect(p).toContain('제안자');             // LLM=제안자·mandate=인가자
    expect(p).toContain('place_order 를 직접 부르지 마라');
  });

  test('maxOrderKrw null → 상한 없음 표기', () => {
    const p = buildLeverageContractPrompt(buildLeverageContract({ maxOrderKrw: null }));
    expect(p).toContain('상한] 없음');
  });
});

describe('validateDecision — 안전 게이트', () => {
  const focus = new Set(['122630.KO', 'KORU.US']);

  test('valid adjust decision passes + normalizes', () => {
    const r = validateDecision({
      action: 'adjust',
      targets: [{ symbol: '122630.KO', targetKrw: 3_000_000, reason: 'R3 회복' }],
      stops: [{ symbol: '122630.KO', stopPrice: 15000 }],
      rationale: '선물 미결제 증가 + 풋콜 하락 → 리스크온',
      confidence: 0.7,
      digEvidence: { putCallRatio: 1.1 },
    }, focus);
    expect('value' in r).toBe(true);
    if ('value' in r) {
      expect(r.value.action).toBe('adjust');
      expect(r.value.targets[0]!.symbol).toBe('122630.KO');
      expect(r.value.digEvidence).toEqual({ putCallRatio: 1.1 });
    }
  });

  test('hold with no targets ok', () => {
    const r = validateDecision({ action: 'hold', rationale: '변화 없음', confidence: 0.5 }, focus);
    expect('value' in r).toBe(true);
    if ('value' in r) expect(r.value.targets).toEqual([]);
  });

  test('rejects symbol outside whitelist (환각 차단)', () => {
    const r = validateDecision({
      action: 'adjust',
      targets: [{ symbol: '005930.KO', targetKrw: 1_000_000 }],  // 삼성 = 레버 계약 밖
      rationale: 'x', confidence: 0.5,
    }, focus);
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('화이트리스트');
  });

  test('rejects confidence out of range', () => {
    const r = validateDecision({ action: 'hold', rationale: 'x', confidence: 1.5 }, focus);
    expect('error' in r).toBe(true);
  });

  test("rejects action='adjust' with empty targets", () => {
    const r = validateDecision({ action: 'adjust', targets: [], rationale: 'x', confidence: 0.5 }, focus);
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('targets');
  });

  test('rejects missing rationale', () => {
    const r = validateDecision({ action: 'hold', rationale: '  ', confidence: 0.5 }, focus);
    expect('error' in r).toBe(true);
  });
});

describe('buildSubmitDecisionTool', () => {
  test('spec shape + whitelist in description', () => {
    const t = buildSubmitDecisionTool(buildLeverageContract());
    expect(t.spec.name).toBe('submit_trade_decision');
    expect(t.spec.description).toContain('122630.KO');
    const props = t.spec.parameters.properties as Record<string, unknown>;
    expect(props.action).toBeDefined();
    expect(props.targets).toBeDefined();
    expect(t.spec.parameters.required).toContain('action');
  });

  test('dispatch records valid decision → getDecision returns it (dry)', async () => {
    const t = buildSubmitDecisionTool(buildLeverageContract());
    expect(t.getDecision()).toBeNull();
    const out = await t.dispatch({
      action: 'adjust',
      targets: [{ symbol: 'KORU.US', targetWeight: 0.3 }],
      rationale: '충격반등 E 신호',
      confidence: 0.6,
    }) as { ok: boolean; recorded: string };
    expect(out.ok).toBe(true);
    expect(out.recorded).toBe('dry');
    expect(t.getDecision()?.action).toBe('adjust');
    expect(t.getDecision()?.targets[0]!.symbol).toBe('KORU.US');
  });

  test('dispatch rejects out-of-focus symbol → not recorded', async () => {
    const t = buildSubmitDecisionTool(buildLeverageContract());
    const out = await t.dispatch({
      action: 'adjust',
      targets: [{ symbol: 'TSLA.US', targetKrw: 1_000_000 }],
      rationale: 'x', confidence: 0.5,
    }) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(t.getDecision()).toBeNull();
  });
});
