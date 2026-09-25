// conatus-panel 회귀 — 격리 fixture(임시 CONATUS_DATA_DIR·python/네트워크 무의존).
// data.py load_panel 흡수의 reshape·date-guard·비거래일 probe·snapshot 파생을 결정론 검증.
// 라이브 파리티(python↔TS byte-eq)는 scripts/conatus-parity 별도(격리 사본).

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
const prev = process.env.CONATUS_DATA_DIR;

// 3 거래일(월~수) fixture. 006/007 은 마지막날 결측(reindex null 검증).
const CACHE: Record<string, Array<Record<string, number | string>>> = {
  'bulk_KO_2026-06-15.json': [
    { code: '005930', date: '2026-06-15', open: 100, high: 105, low: 99, close: 100, adjusted_close: 100, volume: 1000 },
    { code: '000660', date: '2026-06-15', open: 200, high: 210, low: 195, close: 200, adjusted_close: 200, volume: 500 },
  ],
  'bulk_KO_2026-06-16.json': [
    { code: '005930', date: '2026-06-16', open: 101, high: 112, low: 100, close: 110, adjusted_close: 110, volume: 2000 },
    { code: '000660', date: '2026-06-16', open: 200, high: 205, low: 190, close: 190, adjusted_close: 190, volume: 800 },
  ],
  'bulk_KO_2026-06-17.json': [
    { code: '005930', date: '2026-06-17', open: 110, high: 130, low: 109, close: 121, adjusted_close: 121, volume: 3000 }, // +10%
    { code: '000660', date: '2026-06-17', open: 190, high: 195, low: 180, close: 180, adjusted_close: 180, volume: 400 }, // -5.26%
  ],
  'bulk_KQ_2026-06-15.json': [], 'bulk_KQ_2026-06-16.json': [], 'bulk_KQ_2026-06-17.json': [],
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'conatus-panel-'));
  const cache = join(dir, 'cache');
  mkdirSync(cache, { recursive: true });
  for (const [f, v] of Object.entries(CACHE)) writeFileSync(join(cache, f), JSON.stringify(v));
  // ticker_map: 005930=KOSPI·000660=KOSPI
  writeFileSync(join(cache, 'ticker_map.json'), JSON.stringify({
    '005930': { name: '삼성전자', exchange: 'KOSPI', type: 'Common Stock' },
    '000660': { name: 'SK하이닉스', exchange: 'KOSPI', type: 'Common Stock' },
  }));
  process.env.CONATUS_DATA_DIR = dir;
});
afterAll(() => { if (prev === undefined) delete process.env.CONATUS_DATA_DIR; else process.env.CONATUS_DATA_DIR = prev; if (dir) rmSync(dir, { recursive: true, force: true }); });

test('recentTradingDates: 비거래일 probe(주말·미캐시 skip) + 오름차순', async () => {
  const { recentTradingDates } = await import('./conatus-panel.js');
  const dates = recentTradingDates(3, '2026-06-17');
  expect(dates).toEqual(['2026-06-15', '2026-06-16', '2026-06-17']); // 주말/미캐시 자동 skip
});

test('bulkEod: date-integrity guard — 요청일 데이터만', async () => {
  const { bulkEod } = await import('./conatus-panel.js');
  expect(bulkEod('KO', '2026-06-17').length).toBe(2);
  expect(bulkEod('KO', '2026-06-14')).toEqual([]); // 미캐시(주말) → [](guard)
});

test('loadPanel: reshape·snapshot 파생(chgPct=raw close)·거래소 라벨', async () => {
  const { loadPanel } = await import('./conatus-panel.js');
  const p = loadPanel(3, '2026-06-17');
  expect(p.dates).toEqual(['2026-06-15', '2026-06-16', '2026-06-17']);
  expect(p.codes).toEqual(['000660', '005930']); // 정렬
  // hist close 행렬(date 정렬순)
  expect(p.hist.close.get('005930')).toEqual([100, 110, 121]);
  expect(p.hist.adjClose.get('005930')).toEqual([100, 110, 121]);
  // snapshot: 005930 마지막일 121, 전일 110 → +10%
  const s = p.snap.get('005930')!;
  expect(s.close).toBe(121);
  expect(s.prev).toBe(110);
  expect(Math.round((s.chgPct ?? 0) * 100) / 100).toBe(10);
  expect(s.exchange).toBe('KOSPI');
  expect(s.name).toBe('삼성전자');
  // 000660: 180/190-1 = -5.26%
  const s2 = p.snap.get('000660')!;
  expect(Math.round((s2.chgPct ?? 0) * 100) / 100).toBe(-5.26);
});
