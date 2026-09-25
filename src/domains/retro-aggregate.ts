// ── 회고 루프 집계 (R0 · retro-aggregate · 2026-07-08) ────────────────────
//
// 주/월/분기/연 기간의 정보 변경·전략 성과·국면 전환을 집계하는 순수 함수.
// 밤·idle 리플레이(회고 루프). deps 주입(backtest.db·regime.db·거래 로그) — 순수·
// 테스트 가능. 실배선은 scripts/retro-cycle.ts(R3). 대표 결정: 회고=리포트+제안
// +HITL 승인. [[PLAN-quant-backtest-retro-loops-2026-07-08]] §4.2 · [[ROADMAP-...]] R0.

export type RetroPeriod = 'weekly' | 'monthly' | 'quarterly' | 'annual';

const PERIOD_DAYS: Record<RetroPeriod, number> = { weekly: 7, monthly: 30, quarterly: 91, annual: 365 };

export interface PeriodWindow { period: RetroPeriod; from: string; to: string; days: number }

/** 기간 경계(rolling·순수). now(ISO) 기준 N일 전까지. */
export function periodWindow(period: RetroPeriod, now: string): PeriodWindow {
  const days = PERIOD_DAYS[period];
  const to = now.slice(0, 10);
  const from = new Date(Date.parse(to) - days * 86400_000).toISOString().slice(0, 10);
  return { period, from, to, days };
}

// ── 소스별 집계 결과 ──

export interface BacktestAgg {
  experiments: number;
  byVerdict: Record<string, number>;
  confirmed: number;
  promotions: number;
  topStrategies: Array<{ strategy: string; count: number; confirmed: number }>;
}
export interface RegimeAgg {
  samples: number;
  transitions: number;         // 큰 국면 전환 횟수
  meanComposite: number;       // 평균 국면 강도
  current: string;             // 현재 국면
  distribution: Record<string, number>; // 국면 라벨 분포
}
export interface TradeAgg {
  cycles: number;
  orders: number;
  note?: string;
}
/** 크로스서피스 기억(미엘린·surface_events) 기간 집계 — 무엇을 발송했고 무엇이 재참조됐나. */
export interface SurfaceAgg {
  outbound: number;                        // 기간 발송(outbound) 건수
  byKind: Record<string, number>;          // kind별(alert/digest/report/watch-zone/breaking…)
  recalled: number;                        // recall_count>0 — 이후 회상에 재참조된 발송(미엘린 강화)
  topImportant: Array<{ summary: string; kind: string; importance: number }>; // 상위 중요 발송
}

/** 미션 회고 집계(C3 · 2026-07-18) — 기간 내 C1(안착점검)·C2(피드백) 각인 요약. */
export interface MissionRetroAgg {
  count: number;                              // mission.retro 각인 수
  coherent: number; partial: number; incoherent: number; // verdict 분포
  feedbackCount: number;                      // mission.feedback 각인 수
  frictionTotal: number;                      // 불편(friction) 총합 = taste 신호 강도
  topFindings: string[];                      // 최근 요약(리포트용)
}

export interface RetroDeps {
  backtest: (from: string, to: string) => BacktestAgg;
  regime: (from: string, to: string) => RegimeAgg | null;
  trades?: (from: string, to: string) => TradeAgg | null;
  /** 크로스서피스 기억 집계(미엘린). 미주입/실패 시 null(섹션 생략). */
  surface?: (from: string, to: string) => SurfaceAgg | null;
  /** 미션 회고 집계(C3). 미주입/실패 시 null(섹션 생략·비파괴 opt-in). */
  missions?: (from: string, to: string) => MissionRetroAgg | null;
}

export interface PeriodSummary {
  window: PeriodWindow;
  backtest: BacktestAgg;
  regime: RegimeAgg | null;
  trades: TradeAgg | null;
  surface: SurfaceAgg | null;  // 미엘린 발송·회상 집계
  missions?: MissionRetroAgg | null; // C3 — 미션 회고(안착·피드백) 집계(opt-in·하위호환)
  highlights: string[];        // 리포트용 핵심 관찰(deterministic)
  generatedAt: string;
}

/** 기간 종합 집계(순수·deps 주입). 핵심 관찰(highlights)까지 결정론 조립. */
export function aggregatePeriod(deps: RetroDeps, period: RetroPeriod, now: string): PeriodSummary {
  const window = periodWindow(period, now);
  const backtest = deps.backtest(window.from, window.to);
  const regime = deps.regime(window.from, window.to);
  const trades = deps.trades?.(window.from, window.to) ?? null;
  const surface = deps.surface?.(window.from, window.to) ?? null;
  const missions = deps.missions?.(window.from, window.to) ?? null;

  const highlights: string[] = [];
  if (backtest.experiments > 0) {
    highlights.push(`백테스팅 ${backtest.experiments}건 실험 · CONFIRMED ${backtest.confirmed}건 · 승격 ${backtest.promotions}건`);
    const top = backtest.topStrategies[0];
    if (top && top.confirmed > 0) highlights.push(`최다 검증 전략: ${top.strategy}(CONFIRMED ${top.confirmed}/${top.count})`);
  } else {
    highlights.push('백테스팅 실험 없음(가격 데이터·크론 확인)');
  }
  if (regime) {
    highlights.push(`국면 ${regime.current} · 평균강도 ${regime.meanComposite.toFixed(2)} · 전환 ${regime.transitions}회`);
    const dom = Object.entries(regime.distribution).sort((a, b) => b[1] - a[1])[0];
    if (dom) highlights.push(`주도 국면: ${dom[0]}(${dom[1]}/${regime.samples})`);
  }
  if (trades && trades.cycles > 0) highlights.push(`매매 사이클 ${trades.cycles}회 · 주문 ${trades.orders}건`);
  if (surface && surface.outbound > 0) {
    const kinds = Object.entries(surface.byKind).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join('·');
    highlights.push(`발송 ${surface.outbound}건(${kinds}) · 재참조 ${surface.recalled}건(미엘린)`);
  }

  if (missions && (missions.count > 0 || missions.feedbackCount > 0)) {
    highlights.push(`미션 회고 ${missions.count}건(정합 ${missions.coherent}·부분 ${missions.partial}·불일치 ${missions.incoherent}) · 피드백 ${missions.feedbackCount}건(불편신호 ${missions.frictionTotal})`);
  }

  return { window, backtest, regime, trades, surface, missions, highlights, generatedAt: now };
}
