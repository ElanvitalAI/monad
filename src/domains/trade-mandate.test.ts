import { test, expect, describe } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadMandate, evaluateMandate, inFocus, isSymbolTradeable, DEFAULT_MANDATE, type TradeMandate,
} from './trade-mandate.js';
import type { TradeIntent } from './trade-hitl.js';
import type { MarketSessions } from './finance.js';

const intent = (symbol: string): TradeIntent => ({ id: 't', symbol, side: 'buy', qty: 1, reason: 'r', source: 'signal' });
const armed = (over: Partial<TradeMandate> = {}): TradeMandate => ({ ...DEFAULT_MANDATE, armed: true, focusSymbols: ['005930.KO', '122630.KO', 'KORU.US'], ...over });

/** 세션 스텁 — 마켓 클럭 게이트 테스트/주입용. */
const mkSessions = (over: Partial<MarketSessions> = {}): MarketSessions => ({
  kr: 'OPEN', us: 'OPEN', krLive: true, usLive: true, usOvernight: false,
  krTradeable: true, anyTradeable: true, krHoliday: false, usHoliday: false,
  kstLabel: '', etLabel: '', ...over,
});
const TRADEABLE = mkSessions();          // KR·US 거래 가능
const CLOSED = mkSessions({ kr: 'CLOSED', us: 'CLOSED', krLive: false, usLive: false, krTradeable: false, anyTradeable: false });

describe('loadMandate — 부재/손상 = disarmed(fail-closed)', () => {
  test('파일 없음 → 기본 disarmed', () => {
    expect(loadMandate('/no/such/mandate.json').armed).toBe(false);
  });
  test('json 로드 + 불리언/배열 강제', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mandate-'));
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({ armed: true, live: true, focusSymbols: ['005930.KO', 5, null], restrictToFocus: true }));
    const m = loadMandate(p);
    expect(m.armed).toBe(true);
    expect(m.live).toBe(true);
    expect(m.focusSymbols).toEqual(['005930.KO']); // 비문자 제거
    expect(m.restrictToFocus).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
  test('손상 json → disarmed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mandate-'));
    const p = join(dir, 'm.json'); writeFileSync(p, '{bad');
    expect(loadMandate(p).armed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('inFocus — 심볼 정규화', () => {
  test('접미사 무관 매칭', () => {
    expect(inFocus('005930.KO', ['005930'])).toBe(true);
    expect(inFocus('KORU.US', ['KORU'])).toBe(true);
    expect(inFocus('000660.KO', ['005930.KO'])).toBe(false);
  });
});

describe('evaluateMandate — 자율 집행 게이트', () => {
  test('disarmed → 거부', () => {
    const v = evaluateMandate(intent('005930.KO'), { ...DEFAULT_MANDATE, armed: false });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('disarmed');
  });
  test('manualPause → 거부(대표 매뉴얼)', () => {
    const v = evaluateMandate(intent('005930.KO'), armed({ manualPause: true }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('매뉴얼');
  });
  test('focus 밖 종목도 허용(restrictToFocus=false·나머지 제약없음)', () => {
    const v = evaluateMandate(intent('373220.KO'), armed(), { sessions: TRADEABLE }); // LGES — focus 아님
    expect(v.allowed).toBe(true);
  });
  test('restrictToFocus=true면 focus 밖 거부', () => {
    const v = evaluateMandate(intent('373220.KO'), armed({ restrictToFocus: true }), { sessions: TRADEABLE });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('focus 밖');
  });
  test('긴급상황 → 재승인 필요(자율 대신 물어봄)', () => {
    const v = evaluateMandate(intent('005930.KO'), armed(), { urgentDeviation: true, sessions: TRADEABLE });
    expect(v.allowed).toBe(false);
    expect(v.needsReapproval).toBe(true);
  });
  test('정상 mandate 내 → 허용 · live 반영', () => {
    const v = evaluateMandate(intent('005930.KO'), armed({ live: false }), { sessions: TRADEABLE });
    expect(v.allowed).toBe(true);
    expect(v.live).toBe(false); // dry
    const vLive = evaluateMandate(intent('KORU.US'), armed({ live: true }), { sessions: TRADEABLE });
    expect(vLive.allowed).toBe(true);
    expect(vLive.live).toBe(true);
  });

  // ★ 마켓 클럭 게이트 (2026-07-07 대표 지적 — 자율 경로 세션 차단)
  test('장 마감 → 거부(마켓클럭·armed 여도)', () => {
    const v = evaluateMandate(intent('005930.KO'), armed({ live: true }), { sessions: CLOSED });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('마켓클럭');
  });
  test('KR 장전동시호가 → 거부(krTradeable=false)', () => {
    const auction = mkSessions({ kr: '장전동시호가', krTradeable: false });
    expect(evaluateMandate(intent('005930.KO'), armed(), { sessions: auction }).allowed).toBe(false);
  });
  test('KR NXT애프터 → 허용(krTradeable=true)', () => {
    const nxt = mkSessions({ kr: 'NXT애프터', us: 'CLOSED', usLive: false });
    expect(evaluateMandate(intent('005930.KO'), armed(), { sessions: nxt }).allowed).toBe(true);
  });
  test('US 종목 — KR 열려도 US 닫히면 거부 / US 주간거래면 허용', () => {
    const krOnly = mkSessions({ us: 'CLOSED', usLive: false, usOvernight: false });
    expect(evaluateMandate(intent('KORU.US'), armed(), { sessions: krOnly }).allowed).toBe(false);
    const bo = mkSessions({ us: 'OVERNIGHT(주간거래)', usLive: false, usOvernight: true });
    expect(evaluateMandate(intent('KORU.US'), armed(), { sessions: bo }).allowed).toBe(true);
  });
});

describe('isSymbolTradeable — 마켓 클럭', () => {
  test('KR = krTradeable · US(.US) = usLive|usOvernight', () => {
    expect(isSymbolTradeable('005930.KO', mkSessions({ krTradeable: true }))).toBe(true);
    expect(isSymbolTradeable('005930', mkSessions({ krTradeable: false }))).toBe(false);
    expect(isSymbolTradeable('KORU.US', mkSessions({ usLive: false, usOvernight: false }))).toBe(false);
    expect(isSymbolTradeable('KORU.US', mkSessions({ usLive: false, usOvernight: true }))).toBe(true);
  });
});

describe('loadMandate — 안전 기본 + 파일 반영 (환경독립 fixture)', () => {
  // ★ 실 ~/.elanous/finance-trade-mandate.json 을 읽지 않는다 — 대표가 arming(armed=true)
  //   하면 그 파일이 armed 라 "disarmed 로 시작" 단언이 깨진다(환경의존). loadMandate 의
  //   계약(부재/손상=안전 기본 · 명시=반영)을 fixture 로 결정론 검증한다.
  const withFixture = (contents: string | null, fn: (path: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'mandate-'));
    try {
      const p = join(dir, 'mandate.json');
      if (contents !== null) writeFileSync(p, contents);
      fn(p);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  test('파일 부재 → disarmed(안전 기본·대표 명시 전 자율매매 없음)', () => {
    const m = loadMandate(join(tmpdir(), 'no-such-mandate-file-xyz.json'));
    expect(m.armed).toBe(false);
    expect(m.live).toBe(false);
  });

  test('손상 JSON → disarmed(fail-closed)', () => {
    withFixture('{ not valid json at all', (p) => {
      const m = loadMandate(p);
      expect(m.armed).toBe(false);
      expect(m.live).toBe(false);
    });
  });

  test('armed+live+focusSymbols 명시 → 반영(양방향·arming 계약)', () => {
    withFixture(JSON.stringify({ armed: true, live: true, focusSymbols: ['005930.KO'] }), (p) => {
      const m = loadMandate(p);
      expect(m.armed).toBe(true);
      expect(m.live).toBe(true);
      expect(m.focusSymbols).toContain('005930.KO');
    });
  });

  test('executionMode — orchestrator 명시만 반영·그 외 per-cycle(안전)', () => {
    withFixture(JSON.stringify({ executionMode: 'orchestrator' }), (p) => expect(loadMandate(p).executionMode).toBe('orchestrator'));
    withFixture(JSON.stringify({ executionMode: 'nonsense' }), (p) => expect(loadMandate(p).executionMode).toBe('per-cycle'));
    withFixture(JSON.stringify({}), (p) => expect(loadMandate(p).executionMode).toBe('per-cycle'));
  });

  test('paperSources·freeSwing 파싱(D3 소스별 페이퍼)', () => {
    withFixture(JSON.stringify({ paperSources: ['agent:free-swing', 123], freeSwing: { capitalKrw: 6_666_667 } }), (p) => {
      const m = loadMandate(p);
      expect(m.paperSources).toEqual(['agent:free-swing']); // 문자열만
      expect(m.freeSwing?.capitalKrw).toBe(6_666_667);
    });
    withFixture(JSON.stringify({}), (p) => {
      expect(loadMandate(p).paperSources).toEqual([]);
      expect(loadMandate(p).freeSwing).toBeUndefined();
    });
  });
});
