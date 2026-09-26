// ── 섹터 매력도 (valuechain.py sector_attractiveness TS 포팅 · 2026-07-07) ──
//
// 대표 이관 지시: sector 계산 로직을 외부 Conatus 파이썬(valuechain.py)에서 elanous TS로
// 재포팅. 캡스톤 패턴(계산=TS·데이터=로컬 재사용) 동일. 기존 파이썬은 달력 월봉 리샘플
// (미완성 월 → stale)이었으나, 여기선 rolling window(오늘 기준 daily/weekly/monthly)로
// 재설계 → stale 원천 해소. 데이터: screener.db prices(로컬·백필 완료) 재사용(omni-market
// 재호출 없음). 서브체인을 독립 섹터로 승격 → 40개+ 세분화(대표 지시).
//
// ★ 순수 계산부(computeSectorScores)와 DB I/O(sector-store)는 분리 — 테스트 결정론.

export type SectorWindow = 'daily' | 'weekly' | 'monthly';
export type SectorMarket = 'KR' | 'US';
export type SectorGranularity = 'category' | 'subchain';

/** window 별 캘린더 lookback 일수(대표 정의: 오늘 7/7 기준 daily=어제 7/6 · weekly=7일전
 *  6/30 · monthly=30일전 6/7). 거래일 카운트 아님 — 그 날짜 이전 최근 거래일 종가와 비교. */
export const WINDOW_DAYS: Record<SectorWindow, number> = { daily: 1, weekly: 7, monthly: 30 };

/** KR 밸류체인 (valuechain.py CHAINS 이관 · category -> subchain -> [종목코드]).
 *  큐레이션 dict(확장 용이). 반도체 체인은 캡스톤 초점이라 세분. */
export const KR_CHAINS: Record<string, Record<string, string[]>> = {
  '반도체': {
    '메모리/종합': ['005930', '000660', '000990'],
    'HBM/후공정': ['042700', '222800', '131290', '067310', '036540', '061970', '033640', '131970', '089030'],
    '장비': ['240810', '036930', '319660', '084370', '095610', '281820', '030530', '003160', '212710', '140860', '322310', '161580', '064290', '039030', '403870', '095340'],
    '소재': ['005290', '357780', '014680', '093370', '074600', '183300', '166090', '064760', '104830', '036830', '092070', '036490'],
    '팹리스/파운드리': ['108320', '058470', '399720', '094360'],
  },
  '2차전지': {
    '셀': ['373220', '006400', '096770'],
    '양극재': ['247540', '003670', '066970', '005070', '020150', '086520'],
    '소재/부품/장비': ['278280', '121600', '348370', '137400', '365340', '222080'],
  },
  '자동차': {
    '완성차': ['005380', '000270'],
    '부품/타이어': ['012330', '204320', '018880', '011210', '161390', '002350', '005850', '015750', '010690', '023800'],
  },
  '바이오/제약': {
    'CDMO/바이오': ['207940', '068270', '302440'],
    '신약/ADC': ['196170', '000100', '141080', '298380', '145020', '214150', '000250', '087010'],
    '의료기기/진단': ['099190', '328130', '145720'],
    '제약': ['128940', '069620', '000020', '068760'],
  },
  '방산/우주': { '방산': ['012450', '079550', '064350', '047810', '272210', '003570', '010820'] },
  '조선': { '조선': ['009540', '329180', '010140', '042660', '010620', '082740'], '기자재': ['100090'] },
  '원전/전력': {
    '원전': ['034020', '051600', '052690', '105840', '083650'],
    '전력기기': ['015760', '267260', '103590', '010120', '298040', '006260', '033100', '001440', '062040', '000500', '006340'],
  },
  '로봇/AI': { '로봇': ['277810', '454910', '108490', '056080', '348340', '090360', '388720', '117730'] },
  '인터넷/게임': {
    '인터넷': ['035420', '035720'],
    '게임': ['259960', '036570', '251270', '263750', '293490', '112040', '225570', '462870', '194480', '095660'],
  },
  '화장품': {
    '화장품/뷰티': ['090430', '051900', '002790', '192820', '237880', '161890', '278470', '257720', '018290', '241710', '352480', '439090', '018250', '214450', '226320', '406820', '950140'],
  },
  '엔터/미디어': { '엔터/미디어': ['352820', '035900', '041510', '122870', '035760', '253450', '036420'] },
  '금융': {
    '은행/지주': ['105560', '055550', '086790', '316140', '138040', '024110', '175330', '139130', '323410'],
    '증권/보험': ['005830', '032830', '000810', '006800', '016360', '071050', '377300', '039490'],
  },
  '철강/화학': {
    '철강': ['005490', '004020', '103140', '001230', '016380'],
    '화학': ['051910', '011170', '010950', '011790', '298000', '120110', '285130', '011780', '298050', '006650'],
  },
  '건설/리츠': {
    '건설': ['000720', '047040', '006360', '028050', '375500', '002990', '013580', '000210', '003070', '294870'],
    '리츠': ['395400', '451800', '365550', '448730', '330590'],
  },
  '음식료/유통': {
    '음식료': ['097950', '001680', '280360', '271560', '003230', '005180', '000080', '033780'],
    '유통': ['139480', '069960', '023530', '282330', '007070', '057050', '004170', '071840', '027410'],
  },
  '수소/신재생': { '수소/신재생': ['336260', '112610', '009830', '475150', '389260', '297090', '322000', '100130', '095910'] },
  '통신': { '통신': ['017670', '030200', '032640'] },
  '운송/물류': { '운송/물류': ['086280', '000120', '011200', '003490', '028670', '272450'] },
};

// ── 역인덱스 (valuechain.py `_CODE2CHAIN`/`tag()` 이관 · 2026-07-22 완전흡수) ──
// code -> [category, subchain]. record_daily(screen writer) 가 종목별 체인 태깅에 사용.
// 첫 등장 우선(setdefault 동형). 미태깅 = [null,null]("기타").
const CODE2CHAIN: Record<string, [string, string]> = (() => {
  const m: Record<string, [string, string]> = {};
  for (const [cat, subs] of Object.entries(KR_CHAINS))
    for (const [sub, codes] of Object.entries(subs))
      for (const c of codes) if (!(c in m)) m[c] = [cat, sub];
  return m;
})();

/** 종목코드 → [카테고리, 서브체인] 밸류체인 태그. 미태깅 = [null,null]. */
export function tagChain(code: string): [string | null, string | null] {
  return CODE2CHAIN[code] ?? [null, null];
}

/** US 섹터 = SPDR 11종 + 지수 앵커(각 ETF 1섹터). us-pulse.ts SECTOR_ETFS/ANCHOR_ETFS
 *  재사용 — us_pulse.db bars 에 이미 수집됨(omni-market 재호출 없음). 이름 "테크(XLK)". */
export function usSectorChains(
  sectorEtfs: Record<string, string>, anchorEtfs: Record<string, string> = {},
): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [etf, name] of Object.entries(sectorEtfs)) out[`${name}(${etf})`] = { etf: [etf] };
  for (const [etf, name] of Object.entries(anchorEtfs)) out[`${name}(${etf})`] = { etf: [etf] };
  return out;
}

export interface SectorScore {
  market: SectorMarket;
  window: SectorWindow;
  /** 섹터명 — granularity=subchain 이면 "카테고리·서브체인"(예: "반도체·HBM/후공정"). */
  chain: string;
  /** 평균 window 수익률(%). */
  mom: number;
  /** 상승 종목 비중(%). */
  breadth: number;
  /** 표준화 종합 점수 = z(mom) + z(breadth). 섹터 간 상대. */
  score: number;
  /** 유효 종목수(수익률 계산 성공). */
  n: number;
  /** score 내림차순 순위(1=최강). */
  rank: number;
}

export interface PriceBar { date: string; close: number }

/** 종목 종가 시계열(date asc) → window 수익률(%). now 기준 lookback 이전 최근 거래일 대비.
 *  최신 종가/기준 종가 부족(데이터 없음·0) = null(그 종목 제외). */
export function windowReturnPct(series: PriceBar[], window: SectorWindow, now: string): number | null {
  if (series.length < 2) return null;
  const nowMs = Date.parse(`${now.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(nowMs)) return null;
  const cutoffMs = nowMs - WINDOW_DAYS[window] * 86_400_000;
  // 최신(≤now) 종가.
  let latest: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    const b = series[i]!;
    if (Date.parse(`${b.date.slice(0, 10)}T00:00:00Z`) <= nowMs) { latest = b.close; break; }
  }
  // 기준: cutoff 이전(≤) 가장 최근 종가.
  let base: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    const b = series[i]!;
    if (Date.parse(`${b.date.slice(0, 10)}T00:00:00Z`) <= cutoffMs) { base = b.close; break; }
  }
  if (latest == null || base == null || base <= 0) return null;
  return (latest / base - 1) * 100;
}

/** 섹터 → 종목코드 평탄화 (granularity 반영). category=카테고리 묶음 · subchain=서브체인 독립. */
export function flattenSectors(
  chains: Record<string, Record<string, string[]>>, granularity: SectorGranularity,
): Array<{ chain: string; codes: string[] }> {
  const out: Array<{ chain: string; codes: string[] }> = [];
  for (const [cat, subs] of Object.entries(chains)) {
    if (granularity === 'category') {
      out.push({ chain: cat, codes: Object.values(subs).flat() });
    } else {
      for (const [sub, codes] of Object.entries(subs)) out.push({ chain: `${cat}·${sub}`, codes });
    }
  }
  return out;
}

/** ★ 섹터 매력도 계산(순수 · valuechain.py sector_attractiveness 포팅). 종목 종가맵 →
 *  각 섹터 window 수익률 평균(mom)·상승비중(breadth)·z-표준화 종합점수(score)·순위.
 *  minN 미만 유효종목 섹터는 제외(통계 부실). Never throws. */
export function computeSectorScores(
  pricesByCode: Map<string, PriceBar[]>,
  chains: Record<string, Record<string, string[]>>,
  opts: { market: SectorMarket; window: SectorWindow; now: string; granularity?: SectorGranularity; minN?: number; momOnly?: boolean },
): SectorScore[] {
  const granularity = opts.granularity ?? 'subchain';
  const minN = opts.minN ?? 2;
  const groups = flattenSectors(chains, granularity);

  const raw: Array<{ chain: string; mom: number; breadth: number; n: number }> = [];
  for (const g of groups) {
    const rets: number[] = [];
    for (const code of g.codes) {
      const series = pricesByCode.get(code);
      if (!series) continue;
      const r = windowReturnPct(series, opts.window, opts.now);
      if (r != null && Number.isFinite(r)) rets.push(r);
    }
    if (rets.length < minN) continue;
    const mom = rets.reduce((s, x) => s + x, 0) / rets.length;
    const breadth = (rets.filter(x => x > 0).length / rets.length) * 100;
    raw.push({ chain: g.chain, mom, breadth, n: rets.length });
  }
  if (!raw.length) return [];

  // z-표준화(섹터 간). score = z(mom) + z(breadth).
  const zparams = (key: 'mom' | 'breadth') => {
    const vals = raw.map(r => r[key]);
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    const variance = vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length;
    return { mean, std: Math.sqrt(variance) + 1e-9 };
  };
  const zm = zparams('mom'), zb = zparams('breadth');
  // US(각 ETF=1섹터)는 breadth 가 0/100 이산이라 노이즈 → momOnly. KR 은 z(mom)+z(breadth).
  const scored = raw.map(r => ({
    market: opts.market, window: opts.window, chain: r.chain,
    mom: round2(r.mom), breadth: round2(r.breadth), n: r.n,
    score: round2(opts.momOnly ? (r.mom - zm.mean) / zm.std : (r.mom - zm.mean) / zm.std + (r.breadth - zb.mean) / zb.std),
    rank: 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => { s.rank = i + 1; });
  return scored;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
