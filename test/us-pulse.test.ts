// US 머니무브 펄스 — 탐지 결정론 검증 (대표 요구: "팔란티어 6일 연속" 류 포착).
// 벌크 fetch·LLM 은 머신 의존 → fake fetcher 주입, 탐지/렌더/게이트는 순수 검증.

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeStockSignal, detectNotables, sectorWrap, renderCloseWrap,
  ingestDay, openPulseDb, isOpen30Window, type Bar, type BulkFetcher,
} from '../src/domains/us-pulse.js';

describe('us-pulse detection', () => {
  test('연속 상승 스트릭 — 6일 연속(PLTR 시나리오)', () => {
    const closes = [100, 99, 101, 103, 104, 108, 110, 115]; // 99 이후 6개 연속↑
    const s = computeStockSignal('PLTR', closes, closes.map(() => null))!;
    expect(s.streak).toBe(6);
    expect(s.flags).toContain('6일 연속↑');
  });

  test('연속 하락·급락·신고가 플래그', () => {
    const down = computeStockSignal('X', [110, 108, 105, 101, 97], [null, null, null, null, null])!;
    expect(down.streak).toBe(-4);
    expect(down.flags).toContain('4일 연속↓');

    const spike = computeStockSignal('Y', [100, 106], [null, null])!;
    expect(spike.flags.some(f => f.includes('일간 +6.0%'))).toBe(true);

    const high = computeStockSignal('Z', [100, 99, 98, 100, 102], [null, null, null, null, null])!;
    expect(high.high20).toBe(true);
    expect(high.flags).toContain('20일 신고가');
  });

  test('거래량 z — 평시 대비 폭증 + 유의미 등락 결합 시만', () => {
    const closes = Array.from({ length: 22 }, (_, i) => 100 + (i === 21 ? 3 : 0)); // 마지막 +3%
    const vols = Array.from({ length: 22 }, (_, i) => (i === 21 ? 5_000_000 : 1_000_000 + (i % 3) * 10_000));
    const s = computeStockSignal('V', closes, vols)!;
    expect(s.volZ).toBeGreaterThan(2.5);
    expect(s.flags.some(f => f.includes('거래량'))).toBe(true);
  });

  test('주간 상승률 기준 — 5거래일 ±8% (연속 아님·일간 미달이어도 포착)', () => {
    // 등락 섞이며 5일간 +10% (스트릭 없음·일간 +2.8%뿐)
    const closes = [100, 103, 101, 105, 107, 110];
    const s = computeStockSignal('W', closes, closes.map(() => null))!;
    expect(s.weekPct).toBeCloseTo(10, 0);
    expect(s.flags).toContain('주간 +10.0%');
    // 히스토리 5일 미만이면 주간 미계산 (매일 축적 전제)
    const short = computeStockSignal('S', [100, 102], [null, null])!;
    expect(short.weekPct).toBeNull();
  });

  test('무신호 종목은 flags 없음 → detectNotables 제외', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-'));
    const db = openPulseDb(join(dir, 'p.db'));
    const ins = db.prepare(`INSERT INTO bars(symbol, date, close, volume) VALUES (?,?,?,?)`);
    // 조용한 종목: 미세 등락 반복
    ['2026-07-01', '2026-07-02', '2026-07-03'].forEach((d, i) => ins.run('QUIET', d, 100 + (i % 2) * 0.5, 1e6));
    // 스트릭 종목
    [100, 103, 106, 109, 112].forEach((c, i) => ins.run('HOT', `2026-07-0${i + 1}`, c, 1e6));
    const out = detectNotables(db, ['QUIET', 'HOT']);
    expect(out.map(s => s.symbol)).toEqual(['HOT']);
    expect(out[0]!.streak).toBe(4);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('ingestDay 멱등 — 같은 날짜 재적재 시 null(결산 skip 신호)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-'));
    const db = openPulseDb(join(dir, 'p.db'));
    const bars: Bar[] = [
      { symbol: 'SPY', date: '2026-07-06', close: 620, volume: 1e6 },
      { symbol: 'XLK', date: '2026-07-06', close: 181, volume: 1e6 },
    ];
    const fake: BulkFetcher = () => bars;
    expect(ingestDay(db, ['SPY', 'XLK'], fake)).toEqual({ date: '2026-07-06', added: 2 });
    expect(ingestDay(db, ['SPY', 'XLK'], fake)).toBeNull();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('sectorWrap 정렬 + renderCloseWrap 형식', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-'));
    const db = openPulseDb(join(dir, 'p.db'));
    const ins = db.prepare(`INSERT INTO bars(symbol, date, close, volume) VALUES (?,?,?,?)`);
    ins.run('XLE', '2026-07-05', 100, null); ins.run('XLE', '2026-07-06', 103, null);
    ins.run('XLK', '2026-07-05', 100, null); ins.run('XLK', '2026-07-06', 99, null);
    const sectors = sectorWrap(db, ['XLK', 'XLE'], { XLK: '테크', XLE: '에너지' });
    expect(sectors[0]!.symbol).toBe('XLE'); // +3% 먼저
    const msg = renderCloseWrap('2026-07-06', [], sectors,
      [{ symbol: 'PLTR', dayPct: 2.1, weekPct: 9.5, streak: 6, volZ: null, high20: true, flags: ['6일 연속↑', '주간 +9.5%', '20일 신고가'] }]);
    expect(msg).toContain('🟢 에너지 +3.0%');
    expect(msg).toContain('🟠 테크 -1.0%');
    expect(msg).toContain('🔥 연속상승');
    expect(msg).toContain('· PLTR  +2.1% 🟡  |  주 +9.5% 🟡  |  ↑6일 연속  |  🏔신고가');
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('개장+30 게이트 — ET 09:50~10:25 & OPEN만', () => {
    expect(isOpen30Window(600, true)).toBe(true);   // 10:00 ET
    expect(isOpen30Window(600, false)).toBe(false); // 휴장
    expect(isOpen30Window(570, true)).toBe(false);  // 09:30 개장 직후 (아직)
    expect(isOpen30Window(660, true)).toBe(false);  // 11:00 (지남 — 반대 DST 크론)
  });
});
