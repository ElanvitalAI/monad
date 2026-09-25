// 사후수익률 검증 단위테스트 — 순수(주입 시세·horizon·멱등). B3.
import { test, expect, describe } from 'bun:test';
import { SignalPool, type Signal } from './signal-pool.js';
import { parseExecFill, directionalReturn, runOutcomeCheck, signalOutcomeToEvent, trustReliabilityFactor, learnedTrustFactors, type OutcomeRecord } from './signal-outcome.js';

const NOW = '2026-07-14T12:00:00Z';   // exec 로부터 3일 후
const nowFn = () => NOW;

/** 집행된(paper-filled) 신호 seed. */
function seedExec(p: SignalPool, over: Partial<Signal> = {}, detail = 'PAPER sell 3 005930.KO @286500 (₩859500)'): void {
  const s: Signal = {
    eventId: 'e1', source: 'market', asset: '005930.KO', observedAt: '2026-07-11T00:00:00Z',
    collectedAt: '2026-07-11T00:00:00Z', origin: 'x', trust: 0.9, severity: 'S3', raw: 'r',
    recommendation: 'adjust', gate2At: '2026-07-11T11:00:00Z', confirmed: true, ...over,
  };
  p.ingest(s);
  p.markGate2(s.eventId, { confirmed: true, recommendation: 'adjust', reason: 'r', at: s.gate2At! });
  p.markExec(s.eventId, { mode: 'paper', status: 'paper-filled', detail, at: '2026-07-11T06:00:00Z' });
}

describe('parseExecFill / directionalReturn', () => {
  test('paper detail 파싱', () => {
    const f = parseExecFill('PAPER sell 3 005930.KO @286500 (₩859500)');
    expect(f).toEqual({ side: 'sell', entryPrice: 286500 });
  });
  test('미파싱 → null', () => {
    expect(parseExecFill('no fill here')).toBeNull();
    expect(parseExecFill(undefined)).toBeNull();
  });
  test('방향 수익률 — sell 후 하락=+유리·buy 후 상승=+유리', () => {
    expect(directionalReturn({ side: 'sell', entryPrice: 100 }, 90)).toBeCloseTo(0.1);   // 매도 후 -10% = +0.1
    expect(directionalReturn({ side: 'buy', entryPrice: 100 }, 110)).toBeCloseTo(0.1);
    expect(directionalReturn({ side: 'sell', entryPrice: 100 }, 110)).toBeCloseTo(-0.1);  // 매도 후 상승 = 틀림
  });
});

describe('runOutcomeCheck', () => {
  test('horizon 경과 + 방향 정확(sell 후 하락) → correct·멱등', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedExec(p, { eventId: 'a' });  // sell @286500
      const r = runOutcomeCheck(p, { priceOf: () => 280000, now: nowFn, horizonDays: 3 });  // 하락
      expect(r.verified).toBe(1);
      expect(r.correct).toBe(1);
      expect(p.outcomeHitRate().hitRate).toBe(1);
      // 멱등 — 재검증 대상 0.
      expect(runOutcomeCheck(p, { priceOf: () => 280000, now: nowFn }).checked).toBe(0);
    } finally { p.close(); }
  });

  test('sell 후 상승 → 틀림(correct=0)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedExec(p, { eventId: 'a' });
      const r = runOutcomeCheck(p, { priceOf: () => 300000, now: nowFn, horizonDays: 3 });  // 상승
      expect(r.verified).toBe(1);
      expect(r.correct).toBe(0);
    } finally { p.close(); }
  });

  test('horizon 미도래 → skip(미검증)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedExec(p, { eventId: 'a' });
      const r = runOutcomeCheck(p, { priceOf: () => 280000, now: () => '2026-07-12T06:00:00Z', horizonDays: 3 });  // 1일만
      expect(r.verified).toBe(0);
      expect(r.skipped).toBe(1);
      expect(p.listPendingOutcome().length).toBe(1);  // 아직 대기
    } finally { p.close(); }
  });

  test('시세 없음 → skip(재시도 여지)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedExec(p, { eventId: 'a' });
      const r = runOutcomeCheck(p, { priceOf: () => null, now: nowFn, horizonDays: 3 });
      expect(r.skipped).toBe(1);
      expect(p.listPendingOutcome().length).toBe(1);
    } finally { p.close(); }
  });

  test('★ H1 — onOutcome 콜백이 검증분마다 사후결과와 함께 호출(기억 각인 seam)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedExec(p, { eventId: 'a' });   // sell @286500
      const seen: OutcomeRecord[] = [];
      runOutcomeCheck(p, { priceOf: () => 280000, now: nowFn, horizonDays: 3, onOutcome: (rec) => seen.push(rec) });
      expect(seen.length).toBe(1);
      expect(seen[0]!.eventId).toBe('a');
      expect(seen[0]!.side).toBe('sell');
      expect(seen[0]!.correct).toBe(true);           // sell 후 하락 = 정확
      expect(seen[0]!.asset).toBe('005930.KO');
      expect(seen[0]!.ret).toBeGreaterThan(0);
    } finally { p.close(); }
  });

  test('★ H1 — onOutcome throw 는 사후검증에 무영향(fail-soft)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedExec(p, { eventId: 'a' });
      const r = runOutcomeCheck(p, { priceOf: () => 280000, now: nowFn, horizonDays: 3, onOutcome: () => { throw new Error('sink down'); } });
      expect(r.verified).toBe(1);                    // 각인 실패해도 검증은 완료
      expect(p.outcomeHitRate().hitRate).toBe(1);
    } finally { p.close(); }
  });
});

describe('signalOutcomeToEvent — 사후결과 → 기억 각인 이벤트(H1)', () => {
  const base: OutcomeRecord = { eventId: 'e1', asset: '005930.KO', side: 'sell', ret: 0.031, correct: true, at: NOW };

  test('현저성 = |수익률| 기반(정확 +1)·kind=signal·finance', () => {
    const ev = signalOutcomeToEvent(base);            // +3.1% 정확
    expect(ev.kind).toBe('signal');
    expect(ev.domain).toBe('finance');
    expect(ev.direction).toBe('outbound');
    expect(ev.importance).toBe(8);                    // round(5 + 3.1/2)=round(6.55)=7, +1(정확)=8
    expect(ev.tags).toBe('005930.KO');
    expect(ev.summary).toContain('보호');             // sell = 보호
    expect(ev.summary).toContain('정확');
  });

  test('refs 에 signalId·ret·correct 구조화(회상 후 추적)', () => {
    const ev = signalOutcomeToEvent(base);
    const refs = JSON.parse(ev.refs as string) as { signalId: string; correct: boolean };
    expect(refs.signalId).toBe('e1');
    expect(refs.correct).toBe(true);
  });

  test('buy 빗나감 = 확대·빗나감 라벨', () => {
    const ev = signalOutcomeToEvent({ ...base, side: 'buy', ret: -0.02, correct: false });
    expect(ev.summary).toContain('확대');
    expect(ev.summary).toContain('빗나감');
    expect(ev.importance).toBeLessThanOrEqual(10);
  });

  test('큰 움직임 → importance 상한 10', () => {
    const ev = signalOutcomeToEvent({ ...base, ret: 0.5, correct: true });  // +50%
    expect(ev.importance).toBe(10);
  });
});

describe('trustReliabilityFactor / learnedTrustFactors — 적응형 신뢰 되먹임(H2)', () => {
  test('minSample 미만 = 1.0(중립·증거 부족)', () => {
    expect(trustReliabilityFactor({ verified: 3, hitRate: 1.0 }, { minSample: 10 })).toBe(1.0);
    expect(trustReliabilityFactor(undefined)).toBe(1.0);
  });
  test('hit-rate 0.5 = 1.0(무작위 기준)', () => {
    expect(trustReliabilityFactor({ verified: 20, hitRate: 0.5 })).toBeCloseTo(1.0);
  });
  test('적중 편향 상방 완만(+최대 15%)·빗나감 하방 강(-최대 30%·보수)', () => {
    expect(trustReliabilityFactor({ verified: 20, hitRate: 1.0 })).toBeCloseTo(1.15);   // +0.5×0.3
    expect(trustReliabilityFactor({ verified: 20, hitRate: 0.0 })).toBeCloseTo(0.7);    // -0.5×0.6
    expect(trustReliabilityFactor({ verified: 20, hitRate: 0.7 })).toBeCloseTo(1.06);   // +0.2×0.3
  });
  test('learnedTrustFactors — 소스맵 → 팩터맵', () => {
    const f = learnedTrustFactors({ news: { verified: 20, hitRate: 0.8 }, community: { verified: 4, hitRate: 0.9 } });
    expect(f.news).toBeCloseTo(1.09);   // 검증 충분 → 반영
    expect(f.community).toBe(1.0);      // 소표본 → 중립
  });
});
