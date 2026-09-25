// conatus-backtest 회귀 — 격리 fixture(임시 CONATUS_DATA_DIR·python/네트워크 무의존).
// backtest.py·factor_research.py 흡수의 공통주필터·pct_change·신호마스크·forward 초과수익·qcut 을
// 손계산 가능한 결정론 값으로 검증. 라이브 파리티(python↔TS 4자리 일치)는 scripts/conatus-parity 별도.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
const prev = process.env.CONATUS_DATA_DIR;

// 6 거래일. 공통주 A(000001)·B(000002) + 제외대상 3종(ETF/우선주/TIGER).
// A close: 100,110,121,100,100,100 · B close: 200,200,200,220,200,200 · open=close(진입계산 단순화).
const DATES = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-22'];
const A = [100, 110, 121, 100, 100, 100];
const B = [200, 200, 200, 220, 200, 200];

function row(code: string, date: string, close: number) {
  return { code, date, open: close, high: close, low: close, close, adjusted_close: close, volume: 1000 };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'conatus-bt-'));
  const cache = join(dir, 'cache');
  mkdirSync(cache, { recursive: true });
  DATES.forEach((d, i) => {
    // KO: 공통주 2종 + 제외 3종(같은 날 후보열로 등장 후 필터로 제거되는지 검증).
    const ko = [
      row('000001', d, A[i]),
      row('000002', d, B[i]),
      row('000003', d, 500 + i), // KODEX/ETF
      row('000004', d, 600 + i), // 우선주(type)
      row('000005', d, 700 + i), // TIGER(name)
    ];
    writeFileSync(join(cache, `bulk_KO_${d}.json`), JSON.stringify(ko));
    writeFileSync(join(cache, `bulk_KQ_${d}.json`), JSON.stringify([]));
  });
  writeFileSync(
    join(cache, 'ticker_map.json'),
    JSON.stringify({
      '000001': { name: 'Alpha Corp', exchange: 'KOSPI', type: 'Common Stock' },
      '000002': { name: 'Beta Inc', exchange: 'KOSPI', type: 'Common Stock' },
      '000003': { name: 'KODEX 200 ETF', exchange: 'KOSPI', type: 'ETF' }, // 이름·type 둘 다 제외
      '000004': { name: 'Gamma 1PREF', exchange: 'KOSPI', type: 'Preferred Stock' }, // type 에 common 없음 → 제외
      '000005': { name: 'TIGER Momentum', exchange: 'KOSPI', type: '' }, // type 빈값(스킵)이나 name TIGER 제외
    }),
  );
  process.env.CONATUS_DATA_DIR = dir;
});
afterAll(() => {
  if (prev === undefined) delete process.env.CONATUS_DATA_DIR;
  else process.env.CONATUS_DATA_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('loadFullPanel: 공통주 필터(ETF/우선주/TIGER 제외) + date×code 행렬', async () => {
  const { loadFullPanel } = await import('./conatus-backtest.js');
  const pan = loadFullPanel();
  expect(pan.dates).toEqual(DATES); // 오름차순
  expect(pan.codes).toEqual(['000001', '000002']); // 제외 3종 필터, 정렬
  expect(pan.close[0]).toEqual([100, 200]); // d0
  expect(pan.close.map((r) => r[0])).toEqual(A); // 000001 close 열
  expect(pan.close.map((r) => r[1])).toEqual(B); // 000002 close 열
  expect(pan.open[1]).toEqual([110, 200]); // open=close fixture
});

test('pctChange: close[t]/close[t-1]-1, 1행·결측 NaN(forward-fill 없음)', async () => {
  const { pctChange } = await import('./conatus-backtest.js');
  const m = pctChange([
    [100, Number.NaN],
    [110, 200],
    [Number.NaN, 220],
  ]);
  expect(m[0].every((v) => Number.isNaN(v))).toBe(true); // 1행 전부 NaN
  expect(m[1][0]).toBeCloseTo(0.1, 10); // 110/100-1
  expect(Number.isNaN(m[1][1])).toBe(true); // prev NaN → NaN
  expect(Number.isNaN(m[2][0])).toBe(true); // cur NaN → NaN
  expect(m[2][1]).toBeCloseTo(0.1, 10); // 220/200-1
});

test('backtest: 신호마스크 카운트 + 익일시가 forward 횡단면 초과수익(손계산)', async () => {
  const { loadFullPanel, backtest } = await import('./conatus-backtest.js');
  const pan = loadFullPanel();
  const r = backtest(pan, [1]); // 소형 horizon 으로 forward 계산 가능
  const byName = Object.fromEntries(r.signals.map((s) => [s.signal, s]));

  // chg(%): A=[_,10,10,-17.36,0,0] · B=[_,0,0,10,-9.09,0]
  // 상승10%+(단일): A d1,d2 · B d3 → n=3
  expect(byName['상승10%+(단일)'].n).toBe(3);
  expect(byName['상승15%+(단일)'].n).toBe(0);
  expect(byName['상한가(단일)'].n).toBe(0);

  // forward h=1: fwd[t]=close[t+2]/close[t+1]-1, exc=행평균(2종) 차감.
  //   cells (d1,A)=-0.136777 (d2,A)=+0.045455 (d3,B)=0 → mean*100 = -3.0441%
  expect(byName['상승10%+(단일)'].excess[1]).toBeCloseTo(-3.0441, 3);
  expect(Number.isNaN(byName['상승10%+(단일)'].winRate20)).toBe(true); // horizon 20 미포함
  expect(r.tradingDays).toBe(6);
  expect(r.commonStocks).toBe(2);
});

test('qcutLabels: pd.qcut(x,5,labels=False,duplicates=drop) 재현(pandas 실측 일치)', async () => {
  const { qcutLabels } = await import('./conatus-backtest.js');
  // pandas: pd.qcut([1,1,2,3,4,5,6,7,8,9,10,10],5,labels=False,duplicates='drop')
  //         → [0,0,0,1,1,2,2,3,3,4,4,4]
  const labels = qcutLabels([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10], 5);
  expect(labels).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
});

test('liquidMask: 거래대금 rank(pct) 상위 topfrac — 동점 평균순위', async () => {
  const { liquidMask } = await import('./conatus-backtest.js');
  // rolling(win, min_periods=5).mean() 이므로 유효값 5개 필요 → 동일 5행. value=close*vol=[10..50].
  // 마지막행 rank pct=[.2,.4,.6,.8,1.0]·topfrac=0.4→thr=0.6→>=0.6 인 3개(30,40,50) True.
  const oneRow = [10, 20, 30, 40, 50];
  const close = Array.from({ length: 5 }, () => [...oneRow]);
  const vol = Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]);
  const mask = liquidMask(close, vol, 0.4, 5);
  expect(mask[4]).toEqual([0, 0, 1, 1, 1]); // 마지막행(유효값 5개 충족)
});
