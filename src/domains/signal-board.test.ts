// 통합 시그널 보드 집계 단위테스트 — 순수 어댑터·병합.
import { describe, test, expect } from 'bun:test';
import {
  buzzToDetections, digsToDetections, timelineToDetections, regimeToDetections,
  reflectionToDetections, mergeFeed, buildSignalBoard,
} from './signal-board.js';

describe('어댑터', () => {
  test('buzz — sentiment 방향 부호·ratio score', () => {
    const d = buzzToDetections([{ ticker: '000660.KO', recent: 30, ratio: 8, titles: ['하이닉스 급등'] }], new Map([['000660.KO', 0.8]]), '2026-07-10T00:00:00Z');
    expect(d[0]!.title).toContain('000660.KO 급부상 x8');
    expect(d[0]!.title).toContain('📈강세');
    expect(d[0]!.score).toBe(8);
  });
  test('timeline — alerted 🚨·severity=max(urgency,market,impact)', () => {
    const d = timelineToDetections([{ ts: 't', reason: '반도체 급등', urgency: 3, market: 7, impact: 2, alerted: 1, url: 'http://x' }]);
    expect(d[0]!.title).toContain('🚨');
    expect(d[0]!.score).toBe(7);
    expect(d[0]!.link).toBe('http://x');
  });
  test('dig — topic/sector/verdict/confidence', () => {
    const d = digsToDetections([{ ts: 't', topic: '반도체', sector: 'tech', verdict: 'bullish', confidence: 0.8 }]);
    expect(d[0]!.title).toContain('반도체');
    expect(d[0]!.score).toBe(0.8);
  });
  test('regime — transition=1 만 감지', () => {
    const d = regimeToDetections([
      { asOf: 't1', composite: 0.5, regimeLabel: 'RISK_ON', transition: 1 },
      { asOf: 't2', composite: 0.4, regimeLabel: 'RISK_ON', transition: 0 },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]!.title).toContain('국면 전환 → RISK_ON');
  });
  test('reflection — loop 태그 추출', () => {
    const d = reflectionToDetections([{ ts: 't', summary: 'decay·consolidate', tags: 'loop:replay,x' }]);
    expect(d[0]!.title).toContain('replay 회고');
  });
});

describe('mergeFeed', () => {
  test('최신순 정렬·cap', () => {
    const f = mergeFeed([
      [{ source: 'dig', ts: '2026-07-10T01:00:00Z', title: 'a' }],
      [{ source: 'buzz', ts: '2026-07-10T03:00:00Z', title: 'b' }],
      [{ source: 'signal', ts: '2026-07-10T02:00:00Z', title: 'c' }],
    ], 2);
    expect(f.map(d => d.title)).toEqual(['b', 'c']); // 최신 2개
  });
});

describe('buildSignalBoard', () => {
  test('hero(국면/캡스톤) + 통합 feed + bySource', () => {
    const board = buildSignalBoard({
      emerging: [{ ticker: 'MU', recent: 26, ratio: 5, titles: ['micron'] }],
      sentiments: [{ ticker: 'MU', sentiment: 0.7 }],
      digs: [{ ts: '2026-07-10T02:00:00Z', topic: '반도체', verdict: 'bullish', confidence: 0.8 }],
      timeline: [{ ts: '2026-07-10T01:00:00Z', reason: '신호', urgency: 6 }],
      regimeRecent: [{ asOf: '2026-07-10T00:30:00Z', composite: 0.55, regimeLabel: 'RISK_ON', transition: 1 }],
      regimeLatest: { asOf: '2026-07-10T03:00:00Z', composite: 0.55, regimeLabel: 'RISK_ON', transition: 0 },
      capstone: { target: 'DEFENSE', label: '방어' },
      reflectionHits: [{ ts: '2026-07-10T02:30:00Z', summary: 'recap', tags: 'loop:replay' }],
      nowIso: '2026-07-10T04:00:00Z',
    });
    expect(board.regime?.label).toBe('RISK_ON');
    expect(board.capstone?.target).toBe('DEFENSE');
    expect(board.feed.length).toBe(5); // 5 소스 각 1
    expect(board.bySource.buzz).toBe(1);
    expect(board.bySource.reflection).toBe(1);
    // buzz 는 nowIso 라 최신 → feed 선두
    expect(board.feed[0]!.source).toBe('buzz');
  });
});
