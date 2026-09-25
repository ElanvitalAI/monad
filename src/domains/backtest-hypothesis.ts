// ── 백테스팅 가설 생성기 (B1 · backtest-hypothesis · 2026-07-08) ──────────
//
// 그날 정보(dig 신호·섹터 모멘텀·regime·펄스)를 퀀트 컨셉별 포트폴리오 가설로
// 변환하는 순수 함수. 세미나(성창환 박사) + 학술(Jegadeesh-Titman·Moskowitz):
//  - 모멘텀 12-1m(최근 1개월 제외) · TS(절대) vs XS(상대순위)
//  - IR=IC×√Breadth: 단일 신호 금지 → N종목 폭 확보
//  - 완충: regime 오버레이(external_regime_adaptive) · defensive는 momentum_overlay
//  - sweep 금지: 컨셉별 고정 default 파라미터 (과최적화 차단)
//
// 검증된 전략 라이브러리 키(research-log 14·17·22·23):
//  long_only_all_in · momentum_overlay · long_only_z_sized · external_regime_adaptive
// (long_short 는 cyclic 파산 → 제외). 상세 [[PLAN-quant-backtest-retro-loops-2026-07-08]] §4.1.

import type { ExperimentConcept, PortfolioExperiment } from './backtest-store.js';
import { experimentId } from './backtest-store.js';

/** 그날 시장 컨텍스트 — 실제 데이터 연동은 B5(cycle). 여기선 순수 입력. */
export interface MarketContext {
  date: string;                    // YYYY-MM-DD
  regime: string;                  // 캡스톤/국면 라벨 (RISK_ON·BEAR_CASH 등)
  momentumTs: Array<{ symbol: string; ret: number }>;   // 절대 트렌드(양수=상승)
  momentumXs: Array<{ symbol: string; relRank: number }>; // 상대순위(1=최상위)
  sectorLeaders?: Array<{ sector: string; symbols: string[] }>; // 섹터 모멘텀 상위
  pulseNotables?: string[];        // 급등락 종목(us-pulse/screener)
}

export interface PortfolioHypothesis {
  concept: ExperimentConcept;
  universe: string[];
  strategy: string;
  params: Record<string, unknown>;
  hypothesis: string;
  sourceSignals: string[];
}

const MIN_BREADTH = 3;             // IR=IC×√Breadth: 최소 독립 베팅 수
const TOP_N = 5;                   // 컨셉당 유니버스 상한(폭 확보 + 관리)

/** regime 문자열로 강세/약세 근사(전략 매핑용). */
function isBullish(regime: string): boolean {
  return /RISK_ON|BULL|R3|RECOVERY|1X|1_5X|1_75X/i.test(regime);
}

/** 그날 컨텍스트 → 컨셉별 포트폴리오 가설(deterministic·sweep 금지). */
export function generateHypotheses(ctx: MarketContext): PortfolioHypothesis[] {
  const out: PortfolioHypothesis[] = [];
  const bull = isBullish(ctx.regime);

  // ① momentum-ts (절대 트렌드) — 양수 수익 종목 롱. 강세=추종, 약세=완충 오버레이.
  const tsWinners = ctx.momentumTs.filter(m => m.ret > 0).sort((a, b) => b.ret - a.ret).slice(0, TOP_N);
  if (tsWinners.length >= MIN_BREADTH) {
    out.push({
      concept: 'momentum-ts',
      universe: tsWinners.map(m => m.symbol),
      strategy: bull ? 'external_regime_adaptive' : 'momentum_overlay',
      params: { lookbackDays: 252, skipRecentDays: 21, holdDays: 20 },  // 12-1m
      hypothesis: `절대 모멘텀 상위 ${tsWinners.length}종목 롱 (${bull ? '강세 추종' : '약세 완충'})`,
      sourceSignals: [`regime:${ctx.regime}`, 'momentum-ts'],
    });
  }

  // ② momentum-xs (상대순위) — 상위 랭크 equal-weight. MDD 완화 z-sized.
  const xsLeaders = ctx.momentumXs.slice().sort((a, b) => a.relRank - b.relRank).slice(0, TOP_N);
  if (xsLeaders.length >= MIN_BREADTH) {
    out.push({
      concept: 'momentum-xs',
      universe: xsLeaders.map(m => m.symbol),
      strategy: 'long_only_z_sized',
      params: { lookbackDays: 252, skipRecentDays: 21, weight: 'equal' },
      hypothesis: `상대 모멘텀 상위 ${xsLeaders.length}종목 등비중`,
      sourceSignals: [`regime:${ctx.regime}`, 'momentum-xs'],
    });
  }

  // ③ weekly-swing (주간 스윙·20 거래일 window) — 강세장 dip 스윙.
  const swingUniverse = [...new Set([...tsWinners.map(m => m.symbol), ...(ctx.pulseNotables ?? [])])].slice(0, TOP_N);
  if (bull && swingUniverse.length >= MIN_BREADTH) {
    out.push({
      concept: 'weekly-swing',
      universe: swingUniverse,
      strategy: 'long_only_all_in',
      params: { window: 20, entryZ: -1.0, volScaled: true },  // 변동성 스케일링(momentum crash 완화)
      hypothesis: `주간 스윙 — 20일 window 변동성 스케일 ${swingUniverse.length}종목`,
      sourceSignals: [`regime:${ctx.regime}`, 'weekly-swing', 'pulse'],
    });
  }

  // ④ monthly-swing (월간 스윙·60 거래일 window) — 섹터 로테이션 상위.
  const sectorSyms = (ctx.sectorLeaders ?? []).flatMap(s => s.symbols).slice(0, TOP_N);
  if (sectorSyms.length >= MIN_BREADTH) {
    out.push({
      concept: 'monthly-swing',
      universe: sectorSyms,
      strategy: bull ? 'long_only_all_in' : 'momentum_overlay',
      params: { window: 60, rebalance: 'monthly', volScaled: true },
      hypothesis: `월간 스윙 — 섹터 리더 ${sectorSyms.length}종목 60일 window`,
      sourceSignals: [`regime:${ctx.regime}`, 'monthly-swing', 'sector'],
    });
  }

  // ⑤ dual-momentum (TS∩XS 교집합) — 절대+상대 동시 강세. 로버스트.
  const xsSet = new Set(xsLeaders.map(m => m.symbol));
  const dual = tsWinners.map(m => m.symbol).filter(s => xsSet.has(s));
  if (dual.length >= MIN_BREADTH) {
    out.push({
      concept: 'dual-momentum',
      universe: dual,
      strategy: 'external_regime_adaptive',
      params: { lookbackDays: 252, skipRecentDays: 21, requireBoth: true },
      hypothesis: `듀얼 모멘텀 — 절대·상대 동시 강세 ${dual.length}종목`,
      sourceSignals: [`regime:${ctx.regime}`, 'dual-momentum'],
    });
  }

  return out;
}

/** 가설 → 저장용 실험(멱등 id·seed=universe로 같은 날 중복 방지). */
export function toExperiment(h: PortfolioHypothesis, runDate: string, createdAt: string): PortfolioExperiment {
  const seed = h.universe.join(',');
  return {
    id: experimentId(h.concept, runDate, seed),
    runDate, concept: h.concept, hypothesis: h.hypothesis,
    universe: h.universe, strategy: h.strategy, params: h.params,
    sourceSignals: h.sourceSignals, createdAt,
  };
}
