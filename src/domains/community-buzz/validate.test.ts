// 버즈 검증(Goodhart) 단위테스트 — 방향 hit-rate(가격 주입).
import { describe, test, expect } from 'bun:test';
import { openBuzzDb } from './store.js';
import { emergedSentiments, validateDirection, forwardCandidates, validateForwardReturns, type TickerSentiment, type EmergenceRow } from './validate.js';
import { ensureEmergenceTable, recordEmergence } from './novelty.js';

describe('validateDirection — 방향 일치 hit-rate', () => {
  const sents: TickerSentiment[] = [
    { ticker: 'A', sentiment: 0.8, n: 5 },   // 강세 감정
    { ticker: 'B', sentiment: -0.7, n: 4 },  // 약세 감정
    { ticker: 'C', sentiment: 0.05, n: 3 },  // 중립(제외)
    { ticker: 'D', sentiment: 0.6, n: 6 },
  ];
  test('감정 부호 vs 가격 부호 일치=hit·중립/무시세 제외·표본부족 null', () => {
    const move = (t: string): number | null => ({ A: 1.5, B: -2.0, C: 3.0, D: -1.0 } as Record<string, number>)[t] ?? null;
    const r = validateDirection(sents, move, { minSample: 3 });
    // A(강세→상승 hit)·B(약세→하락 hit)·D(강세→하락 miss)·C 제외
    expect(r.n).toBe(3);
    expect(r.hits).toBe(2);
    expect(r.hitRate).toBe(0.67);
    expect(r.note).toContain('알파');
  });
  test('표본 부족 → hitRate null·가드 가동 note', () => {
    const r = validateDirection(sents, () => 1.0, { minSample: 10 });
    expect(r.hitRate).toBeNull();
    expect(r.note).toContain('표본 부족');
  });
  test('역상관 경고', () => {
    const bad: TickerSentiment[] = Array.from({ length: 6 }, (_, i) => ({ ticker: `T${i}`, sentiment: 0.8, n: 3 }));
    const r = validateDirection(bad, () => -2.0, { minSample: 5 }); // 전부 강세인데 다 하락
    expect(r.hitRate).toBe(0);
    expect(r.note).toContain('노이즈 의심');
  });
});

describe('emergedSentiments — 종목별 커뮤니티 감정', () => {
  test('emergence 종목의 buzz_posts 감정 평균', () => {
    const db = openBuzzDb(':memory:');
    ensureEmergenceTable(db);
    recordEmergence(db, new Date().toISOString(), { ticker: 'MU', recent: 5, baseline: 1, ratio: 5, titles: ['t'] });
    const ins = db.prepare(`INSERT INTO buzz_posts(id, ts, fetch_ts, forum, title, tickers, sentiment) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'fmkorea', 't', 'MU', ?)`);
    ins.run('p1', 0.6); ins.run('p2', 0.8);
    const s = emergedSentiments(db, { minPosts: 2 });
    expect(s.length).toBe(1);
    expect(s[0]!.ticker).toBe('MU');
    expect(s[0]!.sentiment).toBeCloseTo(0.7, 5);
  });
});

describe('validateForwardReturns — forward 수익 예측력(승급)', () => {
  const rows: EmergenceRow[] = [
    { ticker: 'A', ts: 't', priceAt: 100, sentiment: 0.8 },   // 강세 → +5% (hit)
    { ticker: 'B', ts: 't', priceAt: 50, sentiment: -0.7 },   // 약세 → -4% (hit)
    { ticker: 'C', ts: 't', priceAt: 200, sentiment: 0.05 },  // 중립 감정 → 방향 미평가
    { ticker: 'D', ts: 't', priceAt: 80, sentiment: 0.6 },    // 강세 → -3% (miss)
    { ticker: 'E', ts: 't', priceAt: 10, sentiment: 0.9 },    // 시세 없음 → 제외
  ];
  test('감정 부호 vs forward 수익 부호 일치=hit·중립/무시세 제외·평균수익 계산', () => {
    const now: Record<string, number> = { A: 105, B: 48, C: 210, D: 77.6 }; // E 없음
    const f = validateForwardReturns(rows, t => now[t] ?? null, { minSample: 3 });
    expect(f.n).toBe(4);            // A,B,C,D (E 시세없음 제외)
    expect(f.directional).toBe(3); // A,B,D (C 중립 미평가)
    expect(f.hits).toBe(2);        // A,B hit / D miss
    expect(f.hitRate).toBe(0.67);
    expect(f.note).toContain('예측력 알파');
    expect(f.meanRetBull).not.toBeNull(); // A(+5),C(+5),D(-3) 강세 평균
  });
  test('방향 표본 부족 → hitRate null', () => {
    const f = validateForwardReturns(rows, () => 105, { minSample: 10 });
    expect(f.hitRate).toBeNull();
    expect(f.note).toContain('표본 부족');
  });
});

describe('forwardCandidates — 창 경과 앵커 조회', () => {
  test('가격 앵커 있고 minHold 경과·maxAge 이내 티커별 최초 emergence', () => {
    const db = openBuzzDb(':memory:');
    ensureEmergenceTable(db);
    const ins = db.prepare(`INSERT INTO ticker_emergence(ts, ticker, recent, ratio, price_at_emergence, sentiment_at_emergence) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?),?,?,?,?,?)`);
    ins.run('-48 hours', 'NVDA', 4, 5, 100, 0.8);  // 창 경과 · 최초
    ins.run('-30 hours', 'NVDA', 5, 6, 110, 0.7);  // 같은 티커 나중(제외 — MIN(ts))
    ins.run('-2 hours', 'MU', 3, 4, 50, 0.5);      // minHold(24h) 미경과 → 제외
    ins.run('-200 hours', 'AMD', 3, 4, 80, 0.3);   // maxAge(168h) 초과 → 제외
    ins.run('-40 hours', 'SNDK', 3, 4, null, 0.6); // 가격 앵커 없음 → 제외
    const cands = forwardCandidates(db, { minHoldHours: 24, maxAgeHours: 168 });
    expect(cands.map(c => c.ticker).sort()).toEqual(['NVDA']);
    expect(cands[0]!.priceAt).toBe(100); // 최초 emergence 가격
  });
});
