// Signal bridge 매퍼 단위테스트 — 순수. A1b.
import { test, expect, describe } from 'bun:test';
import {
  buzzPostToSignal, breakingSignalToSignal, communityTrust,
  matchFocusSymbol, aggregateBearish, bearishFloodSignals, type BearishBuzzRow,
} from './signal-bridge.js';

describe('buzzPostToSignal', () => {
  test('커뮤니티 매핑·저신뢰·티커 dedup', () => {
    const s = buzzPostToSignal({ id: 'fmkorea:1', ts: '2026-07-11T00:00:00Z', fetch_ts: '2026-07-11T00:00:01Z', forum: 'fmkorea', author: '냥이', title: '삼성 간다', url: 'http://x', tickers: '005930', posted_at: '2026-07-11T00:00:00Z' });
    expect(s.eventId).toBe('fmkorea:1');
    expect(s.source).toBe('community');
    expect(s.trust).toBe(0.4);
    expect(s.asset).toBe('005930');
    expect(s.dedupGroup).toBe('005930');
    expect(s.raw).toBe('삼성 간다');
  });
  test('티커 없으면 asset/dedup 생략', () => {
    const s = buzzPostToSignal({ id: 'x', ts: '2026-07-11T00:00:00Z', title: '잡담' });
    expect(s.asset).toBeUndefined();
    expect(s.dedupGroup).toBeUndefined();
  });
  test('인기글(popular lane) 은 신뢰도 상향 0.6(대표 2026-07-15·L2)', () => {
    const pop = buzzPostToSignal({ id: 'fmkorea:2', ts: '2026-07-11T00:00:00Z', lane: 'popular', title: '인기글', tickers: '005930' });
    expect(pop.trust).toBe(0.6);
    const fire = buzzPostToSignal({ id: 'fmkorea:3', ts: '2026-07-11T00:00:00Z', lane: 'firehose', title: '잡담', tickers: '005930' });
    expect(fire.trust).toBe(0.4);
    expect(communityTrust('popular')).toBe(0.6);
    expect(communityTrust(null)).toBe(0.4);
  });
});

describe('matchFocusSymbol — 접미사 무관 focus 매칭', () => {
  test('접미사 정규화 매칭·focus 원형 반환', () => {
    expect(matchFocusSymbol('005930.KO', ['005930.KO', 'KORU.US'])).toBe('005930.KO');
    expect(matchFocusSymbol('005930', ['005930.KO'])).toBe('005930.KO');   // buzz 접미사 없어도 매칭
    expect(matchFocusSymbol('000660.KO', ['005930.KO', 'KORU.US'])).toBeNull();  // 비focus(하이닉스)
  });
});

describe('aggregateBearish + bearishFloodSignals — 반복 하락 급증(L1)', () => {
  const rows = (n: number, ticker: string, sent: number, imp = 6): BearishBuzzRow[] =>
    Array.from({ length: n }, (_, i) => ({ tickers: ticker, sentiment: sent, importance: imp, title: `하락글${i}`, fetch_ts: `2026-07-15T05:${String(i).padStart(2, '0')}:00Z` }));

  test('focus 티커 하락 글 집계·비focus 제외', () => {
    const aggs = aggregateBearish([...rows(15, '005930.KO', -0.6), ...rows(20, '000660.KO', -0.7)], ['005930.KO', 'KORU.US']);
    expect(aggs).toHaveLength(1);                    // 하이닉스(000660)=비focus 제외
    expect(aggs[0]!.ticker).toBe('005930.KO');
    expect(aggs[0]!.bearishCount).toBe(15);
    expect(aggs[0]!.avgSentiment).toBeCloseTo(-0.6, 5);
  });
  test('약한(비하락) 감정은 집계 제외', () => {
    const aggs = aggregateBearish(rows(15, '005930.KO', -0.1), ['005930.KO']);   // -0.1 > -0.3
    expect(aggs).toHaveLength(0);
  });
  test('임계 이상 → 보호신호 후보(protection·bearish-flood dedupGroup·시간버킷 멱등)', () => {
    const aggs = aggregateBearish(rows(12, '005930.KO', -0.5), ['005930.KO']);
    const sigs = bearishFloodSignals(aggs, { hourBucket: '2026-07-15T05', minBearish: 12 });
    expect(sigs).toHaveLength(1);
    expect(sigs[0]!.proposedAction).toBe('protection');
    expect(sigs[0]!.dedupGroup).toBe('bearish-flood:005930.KO');
    expect(sigs[0]!.eventId).toBe('bearish-flood:005930.KO:2026-07-15T05');   // 멱등 키
    expect(sigs[0]!.source).toBe('community');
    expect(sigs[0]!.asset).toBe('005930.KO');
  });
  test('임계 미만 → 신호 없음(노이즈 억제)', () => {
    const aggs = aggregateBearish(rows(5, '005930.KO', -0.5), ['005930.KO']);
    expect(bearishFloodSignals(aggs, { hourBucket: '2026-07-15T05', minBearish: 12 })).toHaveLength(0);
  });
});

describe('breakingSignalToSignal', () => {
  test('공시성 → disclosure·고신뢰', () => {
    const s = breakingSignalToSignal({ id: 'm:1', ts: '2026-07-11T00:00:00Z', author: 'Reuters', text: 'SEC filing disclosure rule', url: 'http://y', sector: 'Tech' });
    expect(s.source).toBe('disclosure');
    expect(s.trust).toBe(0.9);
    expect(s.dedupGroup).toBe('Tech');
  });
  test('일반 뉴스 → news', () => {
    const s = breakingSignalToSignal({ id: 'm:2', ts: '2026-07-11T00:00:00Z', text: '시장 상승' });
    expect(s.source).toBe('news');
    expect(s.trust).toBe(0.75);
  });
});
