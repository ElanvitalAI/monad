import { test, expect, describe } from 'bun:test';
import {
  buildLeverageContract, buildFreeSwingContract, buildFreeSwingContractPrompt,
  FREE_SWING_UNIVERSE, FREE_SWING_TRIGGER_DEFAULT,
} from './trade-contract.js';

describe('buildFreeSwingContract — 오픈월드 모멘텀 계약(D1)', () => {
  test('기본 계약 — 오픈월드 유니버스·전 신호 도구·intraday·5분', () => {
    const c = buildFreeSwingContract();
    expect(c.id).toBe('free-swing');
    expect(c.horizon).toBe('intraday');
    expect(c.trigger).toBe(FREE_SWING_TRIGGER_DEFAULT);
    expect(c.focusSymbols).toEqual([...FREE_SWING_UNIVERSE]);
    // 전 프레임워크 신호 도구.
    for (const t of ['finance_trend', 'finance_market_backbone', 'finance_kr_flow', 'finance_capstone', 'submit_trade_decision']) {
      expect(c.tools).toContain(t);
    }
    expect(c.reviewMode).toBe('autonomous');
  });

  test('유니버스에 BTC ETF·레버리지·반도체 포함(대표 오픈월드)', () => {
    const u = FREE_SWING_UNIVERSE as readonly string[];
    expect(u).toContain('IBIT.US');   // 비트코인 현물 ETF(주식계좌 커버)
    expect(u).toContain('SOXL.US');   // 반도체 3x 레버리지
    expect(u).toContain('122630.KO'); // KODEX 레버리지
    expect(u).toContain('005930.KO'); // 삼성전자
  });

  test('유니버스 override', () => {
    const c = buildFreeSwingContract({ universe: ['SPY.US', 'QQQ.US'] });
    expect(c.focusSymbols).toEqual(['SPY.US', 'QQQ.US']);
  });

  test('프롬프트 — 유니버스·규율·conviction 방출 지시 포함', () => {
    const p = buildFreeSwingContractPrompt(buildFreeSwingContract());
    expect(p).toContain('오픈월드');
    expect(p).toContain('외국인');
    expect(p).toContain('submit_trade_decision');
    expect(p).toContain('confidence'); // 동적 배분 입력
    expect(p).toContain('IBIT.US');     // 유니버스 명시
  });

  test('레버리지 계약과 별개(id·유니버스 구분)', () => {
    expect(buildLeverageContract().id).toBe('leverage-daytrade');
    expect(buildFreeSwingContract().id).toBe('free-swing');
  });
});
