// ── Conatus 스크리너 가격기반 신호 백테스트 + 팩터 연구 (backtest.py·factor_research.py 흡수) ──
//
// Conatus python `screener/backtest.py`(forward-return 신호 백테스트) + `factor_research.py`
// (저변동성/단기반전 5분위 롱숏)를 TS 로 흡수. monad 가 python 을 shell-out 하지 않도록 순수함수화.
//
// 하이브리드 원칙(engine=skill):
//   · 데이터 I/O·reshape = conatus-panel.ts 재사용(conatusDataDir·tickerMap·BulkRow).
//   · 계산 = pandas 시맨틱을 **정확히** 재현(파리티 게이트로 python↔TS 수치 4자리 일치 검증).
//
// ⚠️ pandas 시맨틱 충실 재현(파리티 핵심):
//   · close.pct_change(fill_method=None) = close[t]/close[t-1]-1, 한쪽 NaN 이면 NaN(forward-fill 없음).
//   · NaN 비교(NaN>=x) = False → 마스크는 순수 boolean(NaN 없음).
//   · .rolling(w).sum()/.max() = min_periods=w 기본 → 유효값 w개 미만이면 NaN.
//   · .rolling(w).std() = ddof=1(표본). .rolling(w,min_periods=k).mean() = 유효값 k개 이상시 평균.
//   · shift(-1)/shift(-(1+h)) = forward shift(행=날짜 오름차순).
//   · fwd.sub(fwd.mean(axis=1), axis=0) = 날짜(행)별 코드 평균(NaN 무시)을 빼는 횡단면 중립화.
//   · np.nanmean(v), v=exc[m & isfinite(exc)] = 마스크 True & 유한 셀의 평균.
//   · pd.qcut(...,duplicates='drop') / rank(pct=True, method='average') 를 알고리즘 그대로 재현.
//
// ⚠️ 결정성: python 은 코드 열 순서가 DataFrame 구성 순(비결정)이나, 본 포트는 코드를 오름차순 정렬한다.
//   백테스트 reductions(횡단면 평균·마스크 카운트) 및 qcut(값 기준 binning)은 **순서 무관**이라 수치
//   동일. 순서는 qcut 경계 동점의 tie-order 에만 영향(값 불변) — 결정성 확보용 2차 정렬.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BulkRow, conatusDataDir, tickerMap } from './conatus-panel.js';

const CRASH = -10.0;
const DD_EXCL = -25.0;
const LIMIT_UP = 29.0;

// 공통주 필터 name 정규식(backtest.py:42 동형·re.I). ACE / SOL / PLUS 는 후행 공백 의도적(단어 오매칭 방지).
const NON_COMMON_NAME_RE =
  /ETF|ETN|KODEX|TIGER|RISE|KBSTAR|ACE |SOL |PLUS |레버리지|인버스|선물|Bond|Leverage|Inverse|리츠|REIT/i;

/** date×code 행렬(값=number, 결측=NaN). pandas DataFrame(date행×code열) 대응. */
export type Matrix = number[][];

export interface FullPanel {
  dates: string[]; // 오름차순
  codes: string[]; // 오름차순(결정성 2차 정렬)
  open: Matrix;
  high: Matrix;
  low: Matrix;
  close: Matrix;
  volume: Matrix;
}

// ─── loadFullPanel: 캐시 bulk 전부 → date×code 행렬 + 공통주 필터 ───────────────

/** <CONATUS_DATA_DIR>/cache/bulk_K?_*.json 전부 읽어 date×code 행렬 5종 + 공통주 필터 적용. */
export function loadFullPanel(): FullPanel {
  const cache = join(conatusDataDir(), 'cache');
  const files = existsSync(cache)
    ? readdirSync(cache)
        .filter((f) => /^bulk_K._.*\.json$/.test(f)) // glob bulk_K?_*.json (KO+KQ 모두)
        .sort()
    : [];

  // field -> date -> code -> value
  const recs: Record<string, Map<string, Map<string, number>>> = {
    open: new Map(),
    high: new Map(),
    low: new Map(),
    close: new Map(),
    volume: new Map(),
  };
  const dateSet = new Set<string>();
  const codeSet = new Set<string>();
  for (const f of files) {
    let rows: BulkRow[];
    try {
      rows = JSON.parse(readFileSync(join(cache, f), 'utf-8')) as BulkRow[];
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const c = r.code;
      const ds = r.date;
      if (!c || !ds) continue;
      dateSet.add(ds);
      codeSet.add(c);
      for (const fld of Object.keys(recs)) {
        let dm = recs[fld].get(ds);
        if (!dm) {
          dm = new Map();
          recs[fld].set(ds, dm);
        }
        const v = (r as unknown as Record<string, unknown>)[fld];
        dm.set(c, toFloat(v));
      }
    }
  }

  const dates = [...dateSet].sort(); // 오름차순(date-index sort)
  // 공통주 필터(ETF/ETN/우선주 제외) — backtest.py:36-44 동형.
  const tm = tickerMap();
  const allCodes = [...codeSet].sort(); // 결정성 2차 정렬(값 무관·tie-order 만)
  const codes = allCodes.filter((c) => {
    const info = tm[c] ?? { name: '', type: '' };
    const nm = info.name ?? '';
    const t = (info.type ?? '').toLowerCase();
    if (t && !t.includes('common')) return false;
    if (NON_COMMON_NAME_RE.test(nm)) return false;
    return true;
  });

  const build = (fld: string): Matrix => {
    const dm = recs[fld];
    return dates.map((ds) => {
      const row = dm.get(ds);
      return codes.map((c) => (row?.has(c) ? (row.get(c) as number) : Number.NaN));
    });
  };
  return {
    dates,
    codes,
    open: build('open'),
    high: build('high'),
    low: build('low'),
    close: build('close'),
    volume: build('volume'),
  };
}

function toFloat(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

// ─── pandas 시맨틱 재현 헬퍼 ────────────────────────────────────────────────

const dims = (m: Matrix): [number, number] => [m.length, m[0]?.length ?? 0];
function filled(nd: number, nc: number, v: number): Matrix {
  return Array.from({ length: nd }, () => new Array<number>(nc).fill(v));
}

/** close.pct_change(fill_method=None): close[t]/close[t-1]-1, 한쪽 결측이면 NaN. 1행 NaN. */
export function pctChange(close: Matrix): Matrix {
  const [nd, nc] = dims(close);
  const out = filled(nd, nc, Number.NaN);
  for (let t = 1; t < nd; t++) {
    for (let c = 0; c < nc; c++) {
      const cur = close[t][c];
      const prev = close[t - 1][c];
      if (Number.isFinite(cur) && Number.isFinite(prev)) out[t][c] = cur / prev - 1; // prev=0 → Inf(pandas 동형)
    }
  }
  return out;
}

/** 원소별 boolean 마스크(NaN 은 항상 false — pandas NaN 비교 동형). 0/1 행렬 반환. */
function cmpMask(m: Matrix, pred: (v: number) => boolean): Matrix {
  const [nd, nc] = dims(m);
  const out = filled(nd, nc, 0);
  for (let t = 0; t < nd; t++)
    for (let c = 0; c < nc; c++) out[t][c] = Number.isFinite(m[t][c]) && pred(m[t][c]) ? 1 : 0;
  return out;
}

/** 0/1(결측없는) 마스크의 rolling(w).sum(): min_periods=w → t<w-1 은 NaN. */
function rollingSum(bin: Matrix, w: number): Matrix {
  const [nd, nc] = dims(bin);
  const out = filled(nd, nc, Number.NaN);
  for (let c = 0; c < nc; c++) {
    for (let t = w - 1; t < nd; t++) {
      let s = 0;
      for (let k = t - w + 1; k <= t; k++) s += bin[k][c];
      out[t][c] = s;
    }
  }
  return out;
}

/** close.rolling(w).max(): min_periods=w → 창 내 유효값 w개(전부)여야 함, 아니면 NaN. */
function rollingMax(m: Matrix, w: number): Matrix {
  const [nd, nc] = dims(m);
  const out = filled(nd, nc, Number.NaN);
  for (let c = 0; c < nc; c++) {
    for (let t = w - 1; t < nd; t++) {
      let mx = -Infinity;
      let ok = true;
      for (let k = t - w + 1; k <= t; k++) {
        const v = m[k][c];
        if (!Number.isFinite(v)) {
          ok = false;
          break;
        }
        if (v > mx) mx = v;
      }
      if (ok) out[t][c] = mx;
    }
  }
  return out;
}

/** ret.rolling(w).std(): min_periods=w(전부 유효), 표본표준편차(ddof=1). */
function rollingStd(m: Matrix, w: number): Matrix {
  const [nd, nc] = dims(m);
  const out = filled(nd, nc, Number.NaN);
  for (let c = 0; c < nc; c++) {
    for (let t = w - 1; t < nd; t++) {
      let ok = true;
      let sum = 0;
      for (let k = t - w + 1; k <= t; k++) {
        const v = m[k][c];
        if (!Number.isFinite(v)) {
          ok = false;
          break;
        }
        sum += v;
      }
      if (!ok || w < 2) continue;
      const mean = sum / w;
      let ss = 0;
      for (let k = t - w + 1; k <= t; k++) ss += (m[k][c] - mean) ** 2;
      out[t][c] = Math.sqrt(ss / (w - 1));
    }
  }
  return out;
}

/** (close*vol).rolling(w, min_periods=minp).mean(): 창 내 유효값 minp개 이상이면 평균. */
function rollingMeanMinp(m: Matrix, w: number, minp: number): Matrix {
  const [nd, nc] = dims(m);
  const out = filled(nd, nc, Number.NaN);
  for (let c = 0; c < nc; c++) {
    for (let t = 0; t < nd; t++) {
      let sum = 0;
      let cnt = 0;
      const from = Math.max(0, t - w + 1);
      for (let k = from; k <= t; k++) {
        const v = m[k][c];
        if (Number.isFinite(v)) {
          sum += v;
          cnt++;
        }
      }
      if (cnt >= minp) out[t][c] = sum / cnt;
    }
  }
  return out;
}

/** 원소곱 A*B(둘 다 유효해야 유효). */
function mul(a: Matrix, b: Matrix): Matrix {
  const [nd, nc] = dims(a);
  const out = filled(nd, nc, Number.NaN);
  for (let t = 0; t < nd; t++)
    for (let c = 0; c < nc; c++) {
      const x = a[t][c];
      const y = b[t][c];
      if (Number.isFinite(x) && Number.isFinite(y)) out[t][c] = x * y;
    }
  return out;
}

/** 스칼라배. */
function scale(m: Matrix, k: number): Matrix {
  return m.map((row) => row.map((v) => (Number.isFinite(v) ? v * k : Number.NaN)));
}

/** m[t]/n[t] - 1 (forward return 계산용). 둘 다 유효해야. n=0 이면 Inf(pandas 동형). */
function ratioMinus1(num: Matrix, den: Matrix): Matrix {
  const [nd, nc] = dims(num);
  const out = filled(nd, nc, Number.NaN);
  for (let t = 0; t < nd; t++)
    for (let c = 0; c < nc; c++) {
      const a = num[t][c];
      const b = den[t][c];
      if (Number.isFinite(a) && Number.isFinite(b)) out[t][c] = a / b - 1;
    }
  return out;
}

/** shift(periods): new[t]=old[t-periods]. periods=-1 → new[t]=old[t+1](forward). 범위밖 NaN. */
function shiftRows(m: Matrix, periods: number): Matrix {
  const [nd, nc] = dims(m);
  const out = filled(nd, nc, Number.NaN);
  for (let t = 0; t < nd; t++) {
    const src = t - periods;
    if (src >= 0 && src < nd) out[t] = m[src].slice();
  }
  return out;
}

/** 날짜(행)별 코드 평균(NaN 무시). 유효값 0이면 NaN. */
function rowMean(m: Matrix): number[] {
  return m.map((row) => {
    let s = 0;
    let n = 0;
    for (const v of row)
      if (Number.isFinite(v)) {
        s += v;
        n++;
      }
    return n ? s / n : Number.NaN;
  });
}

/** m.sub(m.mean(axis=1), axis=0): 행별 평균을 뺀 횡단면 중립화. 평균 NaN 이면 행 전체 NaN. */
function crossDemean(m: Matrix): Matrix {
  const means = rowMean(m);
  const [nd, nc] = dims(m);
  const out = filled(nd, nc, Number.NaN);
  for (let t = 0; t < nd; t++) {
    const mu = means[t];
    for (let c = 0; c < nc; c++) {
      const v = m[t][c];
      if (Number.isFinite(v) && Number.isFinite(mu)) out[t][c] = v - mu;
    }
  }
  return out;
}

/** 원소별 &(둘 다 1). */
function and2(a: Matrix, b: Matrix): Matrix {
  const [nd, nc] = dims(a);
  const out = filled(nd, nc, 0);
  for (let t = 0; t < nd; t++) for (let c = 0; c < nc; c++) out[t][c] = a[t][c] && b[t][c] ? 1 : 0;
  return out;
}
/** 원소별 |(하나라도 1). */
function or2(a: Matrix, b: Matrix): Matrix {
  const [nd, nc] = dims(a);
  const out = filled(nd, nc, 0);
  for (let t = 0; t < nd; t++) for (let c = 0; c < nc; c++) out[t][c] = a[t][c] || b[t][c] ? 1 : 0;
  return out;
}
/** 원소별 ~(NOT). */
function not1(a: Matrix): Matrix {
  return a.map((row) => row.map((v) => (v ? 0 : 1)));
}

/** row 의 rank(pct=True, method='average'): 동점 평균순위/유효개수. NaN→NaN. */
function rankPctRow(row: number[]): number[] {
  const idx: Array<[number, number]> = [];
  for (let i = 0; i < row.length; i++) if (Number.isFinite(row[i])) idx.push([row[i], i]);
  const out = new Array<number>(row.length).fill(Number.NaN);
  const count = idx.length;
  if (count === 0) return out;
  idx.sort((a, b) => a[0] - b[0]);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + 1 + (j + 1)) / 2; // 1-indexed 위치 평균
    for (let k = i; k <= j; k++) out[idx[k][1]] = avgRank / count;
    i = j + 1;
  }
  return out;
}

// ─── backtest ──────────────────────────────────────────────────────────────

export interface BacktestSignal {
  signal: string;
  n: number;
  excess: Record<number, number>; // horizon -> 초과수익%(×100). 표본 없으면 NaN
  winRate20: number; // 승률%(×100). NaN 가능
}
export interface BacktestResult {
  signals: BacktestSignal[];
  firstDate: string;
  lastDate: string;
  tradingDays: number;
  commonStocks: number;
  horizons: number[];
  render(): string;
}

/** 신호 마스크 forward 초과수익 백테스트(backtest.py:backtest 동형). */
export function backtest(pan: FullPanel, horizons: number[] = [5, 10, 20]): BacktestResult {
  const { close, open: openp, dates } = pan;
  const [nd, nc] = dims(close);
  // TODO(adjClose): 분할/배당일 raw-close 버그 — 후속 PR 에서 adjClose 로 교정(현재는 python 파리티 위해 raw close).
  const ret = pctChange(close);
  const chg = scale(ret, 100);

  // 신호 마스크(date×code, close[d]까지 정보). 삽입 순서 = 출력 표 행 순서.
  const cnt15 = rollingSum(cmpMask(ret, (v) => v >= 0.15), 5);
  const cnt20 = rollingSum(cmpMask(ret, (v) => v >= 0.2), 5);
  const cntlim = rollingSum(cmpMask(ret, (v) => v >= 0.29), 5);
  const ncrash = rollingSum(cmpMask(ret, (v) => v <= CRASH / 100), 5);
  const peak5 = rollingMax(close, 5);
  const ddpeak = scale(ratioMinus1(close, peak5), 100); // (close/peak5-1)*100
  const trend2 = cmpMask(cnt15, (v) => v >= 2);
  const watch = or2(cmpMask(cnt20, (v) => v >= 2), cmpMask(cntlim, (v) => v >= 1));
  const excl = or2(
    or2(cmpMask(chg, (v) => v <= CRASH), cmpMask(ncrash, (v) => v >= 2)),
    cmpMask(ddpeak, (v) => v <= DD_EXCL),
  );
  const chgMean = crossDemean(chg);

  const masks: Array<[string, Matrix]> = [
    ['상한가(단일)', cmpMask(chg, (v) => v >= LIMIT_UP)],
    ['상승15%+(단일)', cmpMask(chg, (v) => v >= 15)],
    ['상승10%+(단일)', cmpMask(chg, (v) => v >= 10)],
    ['대세후보(주15%×2)', trend2],
    ['주요와칭(20%×2/상한)', watch],
    ['대세후보_펌프제외', and2(trend2, not1(excl))],
    ['주요와칭_펌프제외', and2(watch, not1(excl))],
    ['아웃퍼포머(rs>0)', cmpMask(chgMean, (v) => v > 0)],
  ];

  // 각 horizon 별 forward 초과수익 exc 사전계산(마스크 무관·재사용).
  const excByH = new Map<number, Matrix>();
  for (const h of horizons) {
    const entry = shiftRows(openp, -1); // 익일시가
    const exitp = shiftRows(close, -(1 + h)); // close[d+1+h]
    const fwd = ratioMinus1(exitp, entry);
    excByH.set(h, crossDemean(fwd)); // 그날 전체 공통주 평균 대비(시장중립)
  }

  const signals: BacktestSignal[] = [];
  for (const [name, m] of masks) {
    let ev = 0;
    for (let t = 0; t < nd; t++) for (let c = 0; c < nc; c++) if (m[t][c]) ev++;
    const excess: Record<number, number> = {};
    let winRate20 = Number.NaN;
    for (const h of horizons) {
      const exc = excByH.get(h) as Matrix;
      let sum = 0;
      let cnt = 0;
      let pos = 0;
      for (let t = 0; t < nd; t++)
        for (let c = 0; c < nc; c++) {
          if (m[t][c] && Number.isFinite(exc[t][c])) {
            sum += exc[t][c];
            cnt++;
            if (exc[t][c] > 0) pos++;
          }
        }
      excess[h] = cnt ? (sum / cnt) * 100 : Number.NaN; // np.nanmean(v)*100
      if (h === 20) winRate20 = cnt ? (pos / cnt) * 100 : Number.NaN; // np.nanmean(v>0)*100
    }
    signals.push({ signal: name, n: ev, excess, winRate20 });
  }

  const firstDate = dates.length ? dates[0] : '';
  const lastDate = dates.length ? dates[dates.length - 1] : '';
  return {
    signals,
    firstDate,
    lastDate,
    tradingDays: nd,
    commonStocks: nc,
    horizons,
    render() {
      return renderBacktest(this);
    },
  };
}

/** backtest.py 텍스트 표를 문자열로 재현(monad 가 슬라이싱). 폭=문자수(python len 동형). */
function renderBacktest(r: BacktestResult): string {
  const lines: string[] = [];
  let header = padEndC('신호', 22) + padStartC('N', 8);
  for (const h of r.horizons) header += padStartC(`초과${h}d`, 9);
  header += padStartC('승률20d', 8);
  lines.push(header);
  for (const s of r.signals) {
    let line = padEndC(s.signal, 22) + padStartC(String(s.n), 8);
    for (const h of r.horizons) line += fmtSignedPct(s.excess[h], 8, 2) + '%';
    line += fmtFixed(s.winRate20, 7, 0) + '%';
    lines.push(line);
  }
  lines.push('');
  lines.push(
    `  기간: ${r.firstDate}~${r.lastDate} (${r.tradingDays}거래일) · 공통주 ${r.commonStocks}`,
  );
  lines.push('  초과 = 익일시가 진입 후 forward, 그날 전체 공통주 평균 대비(시장중립). 양수=알파.');
  return lines.join('\n');
}

// ─── factorResearch ─────────────────────────────────────────────────────────

const H = 20; // forward 보유
const QN = 5; // 분위

/** 거래대금 상위 topfrac 유동 유니버스 마스크(factor_research.py:liquid_mask). 0/1 행렬. */
export function liquidMask(close: Matrix, vol: Matrix, topfrac = 0.4, win = 20): Matrix {
  const value = rollingMeanMinp(mul(close, vol), win, 5);
  const [nd, nc] = dims(value);
  const out = filled(nd, nc, 0);
  const thr = 1 - topfrac;
  for (let t = 0; t < nd; t++) {
    const pr = rankPctRow(value[t]);
    for (let c = 0; c < nc; c++) out[t][c] = Number.isFinite(pr[c]) && pr[c] >= thr ? 1 : 0;
  }
  return out;
}

/** np.quantile 선형보간(sorted). */
function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

function searchsortedLeft(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** pd.qcut(values, QN, labels=False, duplicates='drop') 재현. label(0..nbins-1) 또는 null(NA). */
export function qcutLabels(values: number[], q = QN): (number | null)[] {
  const sorted = [...values].sort((a, b) => a - b);
  const probs: number[] = [];
  for (let i = 0; i <= q; i++) probs.push(i / q);
  const edgesRaw = probs.map((p) => quantileSorted(sorted, p));
  // duplicates='drop': 인접 중복 제거(quantile 은 비감소라 algos.unique 와 동치).
  const bins: number[] = [];
  for (const b of edgesRaw) if (bins.length === 0 || b !== bins[bins.length - 1]) bins.push(b);
  const nb = bins.length;
  return values.map((x) => {
    let id = searchsortedLeft(bins, x); // side='left'
    if (x === bins[0]) id = 1; // include_lowest
    if (id === 0 || id === nb) return null; // na_mask
    return id - 1;
  });
}

/** 팩터 5분위별 forward 평균 배열(길이 QN). index0=최저팩터..QN-1=최고. NaN 가능. */
export function quintileFwd(factor: Matrix, fwd: Matrix, liq: Matrix): number[] {
  const qmeans: number[][] = Array.from({ length: QN }, () => []);
  const nd = factor.length;
  for (let i = 0; i < nd; i++) {
    const f = factor[i];
    const fw = fwd[i];
    const lq = liq[i];
    const okIdx: number[] = [];
    for (let c = 0; c < f.length; c++)
      if (Number.isFinite(f[c]) && Number.isFinite(fw[c]) && lq[c]) okIdx.push(c);
    if (okIdx.length < QN * 4) continue;
    const fv = okIdx.map((c) => f[c]);
    const fwv = okIdx.map((c) => fw[c]);
    const ranks = qcutLabels(fv, QN);
    for (let q = 0; q < QN; q++) {
      const sel: number[] = [];
      for (let k = 0; k < ranks.length; k++) if (ranks[k] === q) sel.push(fwv[k]);
      if (sel.length) qmeans[q].push(nanmean(sel));
    }
  }
  return qmeans.map((x) => (x.length ? nanmean(x) : Number.NaN));
}

function nanmean(xs: number[]): number {
  let s = 0;
  let n = 0;
  for (const v of xs)
    if (Number.isFinite(v)) {
      s += v;
      n++;
    }
  return n ? s / n : Number.NaN;
}

export interface FactorQuintile {
  name: string;
  quintiles: number[]; // 길이 QN, 초과수익%(×100). NaN 가능
  longShort: number; // Q1-Q5 %(×100). NaN 가능
  dataInsufficient: boolean;
}
export interface QuarterRobust {
  period: string; // '2026Q2'
  longShort: number;
  q1: number;
  q5: number;
}
export interface FactorResearchResult {
  panelShape: [number, number];
  liquidUniverse: number;
  horizon: number;
  factors: FactorQuintile[];
  quarterly: QuarterRobust[];
  render(): string;
}

/** 저변동성·단기반전 5분위 롱숏 + 분기 robust(factor_research.py:main 동형). */
export function factorResearch(pan: FullPanel): FactorResearchResult {
  const { close, open: openp, volume, dates } = pan;
  const [nd, nc] = dims(close);
  const ret = pctChange(close);
  const liq = liquidMask(close, volume);
  const entry = shiftRows(openp, -1);
  // TODO(adjClose): 분할/배당일 raw-close 버그 — 후속 PR 에서 adjClose 로 교정(현재는 python 파리티 위해 raw close).
  const fwd = ratioMinus1(shiftRows(close, -(1 + H)), entry);
  const fwdExc = crossDemean(fwd);

  // 유동 유니버스 마지막 행 카운트.
  let liquidUniverse = 0;
  if (nd > 0) for (let c = 0; c < nc; c++) if (liq[nd - 1][c]) liquidUniverse++;

  const lowVol = rollingStd(ret, 20);
  const factorDefs: Array<[string, Matrix]> = [
    ['저변동성(20d vol, 낮을수록 Q1)', lowVol],
    ['단기반전(20d 과거수익, 낮을수록 Q1=패자)', ratioMinus1(close, shiftRows(close, 20))],
    ['단기반전(5d, Q1=패자)', ratioMinus1(close, shiftRows(close, 5))],
  ];

  const factors: FactorQuintile[] = factorDefs.map(([name, fac]) => {
    const q = quintileFwd(fac, fwdExc, liq);
    const allNan = q.every((x) => !Number.isFinite(x));
    const ls = q[0] - q[q.length - 1];
    return {
      name,
      quintiles: q.map((x) => x * 100),
      longShort: ls * 100,
      dataInsufficient: allNan,
    };
  });

  // 분기 robust — 저변동성 롱숏.
  const periods = dates.map(quarterOf);
  const uniqPeriods = [...new Set(periods)].sort();
  const quarterly: QuarterRobust[] = [];
  for (const p of uniqPeriods) {
    const rowIdx = dates.map((_, i) => i).filter((i) => periods[i] === p);
    const sub = (m: Matrix): Matrix => rowIdx.map((i) => m[i]);
    const q = quintileFwd(sub(lowVol), sub(fwdExc), sub(liq));
    const allNan = q.every((x) => !Number.isFinite(x));
    if (!allNan)
      quarterly.push({ period: p, longShort: (q[0] - q[4]) * 100, q1: q[0] * 100, q5: q[4] * 100 });
  }

  return {
    panelShape: [nd, nc],
    liquidUniverse,
    horizon: H,
    factors,
    quarterly,
    render() {
      return renderFactor(this);
    },
  };
}

/** 날짜 → 'YYYYQn'(pd.PeriodIndex freq='Q' str 동형). */
function quarterOf(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}Q${Math.floor((m - 1) / 3) + 1}`;
}

function renderFactor(r: FactorResearchResult): string {
  const lines: string[] = [];
  lines.push(
    `패널 (${r.panelShape[0]}, ${r.panelShape[1]}), 유동 유니버스 ~${r.liquidUniverse}종목, forward ${r.horizon}d\n`,
  );
  for (const f of r.factors) {
    if (f.dataInsufficient) {
      lines.push(`${f.name}: (데이터 부족)`);
      continue;
    }
    lines.push(`=== ${f.name} ===`);
    lines.push(
      '  5분위 초과수익(Q1최저→Q5최고): ' + f.quintiles.map((x) => fmtSigned1(x) + '%').join(' '),
    );
    lines.push(
      `  롱숏 Q1-Q5: ${fmtSigned2(f.longShort)}%  (${f.longShort > 0 ? 'Q1(저변동/패자) 우위' : 'Q5 우위'})\n`,
    );
  }
  lines.push('=== 분기별 저변동성 롱숏(Q1-Q5) robust ===');
  for (const q of r.quarterly) {
    lines.push(
      `  ${q.period}: Q1-Q5 ${fmtSigned2(q.longShort)}% | Q1 ${fmtSigned1(q.q1)}% Q5 ${fmtSigned1(q.q5)}%`,
    );
  }
  lines.push('\n[판정] 롱숏이 매분기 동부호+면 robust 팩터. 부호 섞이면 regime 의존.');
  return lines.join('\n');
}

// ─── python 포매팅 재현(문자수 기준 폭) ──────────────────────────────────────

const clen = (s: string): number => s.length; // JS 문자열 length = python len(BMP 한글 1) 동형
function padEndC(s: string, w: number): string {
  const pad = w - clen(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}
function padStartC(s: string, w: number): string {
  const pad = w - clen(s);
  return pad > 0 ? ' '.repeat(pad) + s : s;
}
/** f"{v:>+W.Pf}" — NaN 은 '+nan'(python format 동형). */
function fmtSignedPct(v: number, w: number, p: number): string {
  const body = Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(p) : '+nan';
  return padStartC(body, w);
}
/** f"{v:>W.Pf}" — 무부호. NaN 은 'nan'. */
function fmtFixed(v: number, w: number, p: number): string {
  const body = Number.isFinite(v) ? v.toFixed(p) : 'nan';
  return padStartC(body, w);
}
/** f"{v:+.1f}" */
function fmtSigned1(v: number): string {
  return Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) : '+nan';
}
/** f"{v:+.2f}" */
function fmtSigned2(v: number): string {
  return Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : '+nan';
}
