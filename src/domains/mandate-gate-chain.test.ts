// mandate 게이트체인 단위테스트 — 순수(주입 mandate/sessions/regime·무네트워크·집행0). A4.
import { test, expect, describe } from 'bun:test';
import type { Signal } from './signal-pool.js';
import { DEFAULT_MANDATE, type TradeMandate } from './trade-mandate.js';
import type { MarketSessions } from './finance.js';
import { classifyAction, evaluateGateChain, type GateChainContext } from './mandate-gate-chain.js';

const NOW = Date.parse('2026-07-11T12:00:00Z');

const sig = (over: Partial<Signal> = {}): Signal => ({
  eventId: 'e1', source: 'disclosure', asset: '005930.KO',
  observedAt: '2026-07-11T11:00:00Z', collectedAt: '2026-07-11T11:00:01Z',
  origin: 'Reuters', trust: 0.9, severity: 'S3', raw: '삼성 관련 리스크',
  confirmed: true, recommendation: 'adjust', gate2At: '2026-07-11T11:55:00Z', ...over,
});

// KR 거래가능 세션.
const KR_OPEN: MarketSessions = {
  kr: 'OPEN', us: 'CLOSED', krLive: true, usLive: false, usOvernight: false,
  krTradeable: true, anyTradeable: true, krHoliday: false, usHoliday: false,
  kstLabel: '', etLabel: '',
};

const armed = (over: Partial<TradeMandate> = {}): TradeMandate => ({ ...DEFAULT_MANDATE, armed: true, live: false, ...over });
const ctx = (over: Partial<GateChainContext> = {}): GateChainContext => ({
  mandate: DEFAULT_MANDATE, regime: { regimeLabel: 'RISK_ON' }, dedupCount: 2,
  sessions: KR_OPEN, now: NOW, ...over,
});

describe('classifyAction', () => {
  test('구조화 proposedAction: 보호 동사 → protection', () => {
    expect(classifyAction(sig({ proposedAction: 'protect exit_all', raw: '' }))).toBe('protection');
    expect(classifyAction(sig({ proposedAction: '비중 축소·헤지', raw: '' }))).toBe('protection');
    expect(classifyAction(sig({ raw: 'sell into strength, de-risk' }))).toBe('protection');
  });
  test('구조화 proposedAction: 확대 동사 → expansion', () => {
    expect(classifyAction(sig({ proposedAction: '레버리지 추가 매수', raw: '' }))).toBe('expansion');
    expect(classifyAction(sig({ proposedAction: 'buy', raw: '', gate2Reason: '' }))).toBe('expansion');
    expect(classifyAction(sig({ raw: 'dip-buy opportunity, scale-in' }))).toBe('expansion');
  });
  test('모호/무 → protection(보수)', () => {
    expect(classifyAction(sig({ gate2Reason: '', raw: '지정학 리스크 모니터링' }))).toBe('protection');
    expect(classifyAction(sig({ proposedAction: '', gate2Reason: '매수도 매도도 가능', raw: '' }))).toBe('protection');
  });

  // ★ 회귀(2026-07-15 실매수 오발주 근본): protect exit_all 신호가 gate2Reason 의 "손실확대"
  //   때문에 expansion 으로 오분류돼 삼성 LIVE 매수가 나감. 이제 protection 고정.
  test('회귀: protect exit_all + 사유 "손실확대" → protection (매수 오분류 금지)', () => {
    const bug = sig({
      proposedAction: 'protect exit_all',
      recommendation: 'adjust',
      gate2Reason: '삼성전자 3.8% 급락과 사전 설정된 exit선 동시 이탈은 손실확대 위험이 커 즉시',
      raw: 'price-guard 급락 005930 4.7%; current 280500 is at or below exit 280500; protect exit_all',
    });
    expect(classifyAction(bug)).toBe('protection');
    // 게이트체인 verdict 의 방향도 sell 이어야(매수 아님).
    const v = evaluateGateChain(bug, ctx({ mandate: armed({ live: true }) }));
    expect(v.action).toBe('protection');
  });

  test('gate2Reason 자유텍스트는 방향을 뒤집지 못한다(proposedAction/ raw 만 권위)', () => {
    // proposedAction 없음·raw 중립 → gate2Reason 에 "매수" 있어도 protection(자유텍스트 제외).
    expect(classifyAction(sig({ proposedAction: '', gate2Reason: '적극 매수 추천', raw: '삼성 관련 리스크' }))).toBe('protection');
  });

  test('actionOverride(LLM 결과 주입) 가 결정론 분류를 대체', () => {
    const s = sig({ proposedAction: '', gate2Reason: '', raw: '중립' }); // 결정론=protection
    const v = evaluateGateChain(s, ctx({ mandate: armed({ live: true }), actionOverride: 'expansion' }));
    expect(v.action).toBe('expansion');
  });
});

describe('게이트체인 — 사전 게이트', () => {
  test('대상 자산 없음 → no-asset 차단', () => {
    const v = evaluateGateChain(sig({ asset: undefined }), ctx());
    expect(v.permitted).toBe(false);
    expect(v.blockedGate).toBe('no-asset');
  });
  test('stale 신호 → freshness 차단', () => {
    const v = evaluateGateChain(sig({ gate2At: '2026-07-11T05:00:00Z' }), ctx());
    expect(v.blockedGate).toBe('freshness');
  });
});

describe('비대칭 — 확대는 엄격, 보호는 관대', () => {
  test('확대: 단일출처(dedup 1) → independence 차단', () => {
    const v = evaluateGateChain(sig({ raw: 'dip-buy 진입', gate2Reason: '' }), ctx({ dedupCount: 1 }));
    expect(v.action).toBe('expansion');
    expect(v.blockedGate).toBe('independence');
  });
  test('보호: 단일출처여도 independence 통과(→ mandate 까지 감)', () => {
    const v = evaluateGateChain(sig({ gate2Reason: '헤지·축소' }), ctx({ dedupCount: 1, mandate: DEFAULT_MANDATE }));
    expect(v.action).toBe('protection');
    // disarmed mandate 라 최종 차단은 mandate 게이트(independence 아님).
    expect(v.blockedGate).toBe('mandate');
  });
  test('확대: 신뢰도 0.6 < 0.75 → trust 차단', () => {
    const v = evaluateGateChain(sig({ raw: 'leverage add', gate2Reason: '', trust: 0.6 }), ctx());
    expect(v.blockedGate).toBe('trust');
  });
  test('보호: 신뢰도 0.5 ≥ 0.4 → trust 통과', () => {
    const v = evaluateGateChain(sig({ gate2Reason: '방어 매도', trust: 0.5 }), ctx({ mandate: DEFAULT_MANDATE }));
    expect(v.blockedGate).not.toBe('trust');
  });
  test('확대: RISK_OFF 국면 → regime 차단', () => {
    const v = evaluateGateChain(sig({ raw: 'dip-buy', gate2Reason: '' }), ctx({ regime: { regimeLabel: 'RISK_OFF' } }));
    expect(v.blockedGate).toBe('regime');
  });
  test('보호: RISK_OFF 국면에서도 regime 통과(방어 허용)', () => {
    const v = evaluateGateChain(sig({ gate2Reason: '헤지 방어' }), ctx({ regime: { regimeLabel: 'RISK_OFF' }, mandate: DEFAULT_MANDATE }));
    expect(v.blockedGate).not.toBe('regime');
  });
});

describe('매력도 축(B2) — 비대칭·fail-soft', () => {
  test('확대 + 매력도 SELL → attractiveness 차단', () => {
    const v = evaluateGateChain(sig({ raw: 'dip-buy 진입', gate2Reason: '' }), ctx({ attractiveness: { signal: 'SELL' } }));
    expect(v.action).toBe('expansion');
    expect(v.blockedGate).toBe('attractiveness');
  });
  test('확대 + 매력도 BUY → 통과(mandate 까지)', () => {
    const v = evaluateGateChain(sig({ raw: 'dip-buy 진입', gate2Reason: '' }), ctx({ attractiveness: { signal: 'BUY' }, mandate: armed() }));
    expect(v.blockedGate).not.toBe('attractiveness');
  });
  test('확대 + 매력도 미스코어(null) → skip(fail-soft·현행)', () => {
    const v = evaluateGateChain(sig({ raw: 'dip-buy 진입', gate2Reason: '' }), ctx({ attractiveness: null, mandate: armed() }));
    expect(v.blockedGate).not.toBe('attractiveness');
  });
  test('보호 + 매력도 SELL → attractiveness 무관(보호는 허용)', () => {
    const v = evaluateGateChain(sig({ gate2Reason: '헤지 방어' }), ctx({ attractiveness: { signal: 'SELL' }, mandate: armed() }));
    expect(v.blockedGate).not.toBe('attractiveness');
  });
});

describe('mandate 게이트 — dry(집행0)', () => {
  test('disarmed(기본) → mandate 차단·dry', () => {
    const v = evaluateGateChain(sig({ gate2Reason: '헤지' }), ctx({ mandate: DEFAULT_MANDATE }));
    expect(v.permitted).toBe(false);
    expect(v.live).toBe(false);
    expect(v.blockedGate).toBe('mandate');
    expect(v.reason).toContain('disarmed');
  });
  test('armed+장중 → permitted, 단 live=false(mandate.live off·dry)', () => {
    const v = evaluateGateChain(sig({ gate2Reason: '방어 축소' }), ctx({ mandate: armed({ live: false }) }));
    expect(v.permitted).toBe(true);
    expect(v.live).toBe(false);       // armed 지만 live off → 여전히 dry
    expect(v.blockedGate).toBeUndefined();
  });
  test('manualPause → mandate 차단', () => {
    const v = evaluateGateChain(sig({ gate2Reason: '헤지' }), ctx({ mandate: armed({ manualPause: true }) }));
    expect(v.permitted).toBe(false);
    expect(v.reason).toContain('정지');
  });
  test('장 시간 아님 → mandate 차단(마켓클럭)', () => {
    const closed: MarketSessions = { ...KR_OPEN, kr: 'CLOSED', krTradeable: false, anyTradeable: false };
    const v = evaluateGateChain(sig({ gate2Reason: '방어' }), ctx({ mandate: armed(), sessions: closed }));
    expect(v.permitted).toBe(false);
    expect(v.reason).toContain('장 시간');
  });
});
