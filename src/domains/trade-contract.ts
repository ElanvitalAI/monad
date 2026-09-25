// ── 트레이딩 계약서(TradeContract) + 레버리지 계약 + 프롬프트 조립 (P2a · 2026-07-09) ──
//
// PLAN-leverage-dig-trading P2. 하나의 트레이딩 에이전트(runTurn) 엔진에 상황별
// 계약서를 주입해 특화한다. LLM 없는 trade-cycle(runAutonomousCycle)은 규칙 코드지
// 에이전트 아님 — 이 계약은 LLM-in-the-loop 결정 에이전트를 위한 선언서다.
//
// 설계: 내부 문서 `DESIGN-leverage-decision-agent-2026-07-09`
// P2a 범위 = 타입 + 레버리지 계약 인스턴스 + 프롬프트 조립. dry-only(집행 미배선).

export type TradeHorizon = 'intraday' | 'swing' | 'position';
export type ReviewMode = 'autonomous' | 'review-first';

export interface TradeContract {
  id: string;
  goal: string;
  horizon: TradeHorizon;
  /** 이 계약이 허용하는 도구셋(디깅 범위 화이트리스트). */
  tools: string[];
  /** 규율 참조 텍스트(레버리지 매뉴얼·계단식·손절 규칙) — 프롬프트에 삽입. */
  discipline: string;
  /** 대상 종목 화이트리스트. 전체 mandate 게이트는 실행 시점(P2b)에 별도 로드·적용;
   *  계약은 프롬프트·결정 검증용 화이트리스트만 carry(심볼 환각 차단). */
  focusSymbols: string[];
  /** 주문 상한(원·null=상한없음). 프롬프트 고지용; 실제 강제는 mandate 게이트. */
  maxOrderKrw: number | null;
  reviewMode: ReviewMode;
  /** 트리거(cron/event) — 관측·P2d 예약 배선용. */
  trigger: string;
}

/** 레버리지 종목 기본 화이트리스트(mandate focusSymbols 와 정합·현물 005930 제외). */
export const LEVERAGE_FOCUS_DEFAULT = ['122630.KO', 'KORU.US'] as const;

/** 장중 5분 주기(대표 지시 2026-07-09 — 레버리지는 5분 안에 상황이 크게 바뀜).
 *  5분 틱은 대부분 싼 watch 패스, 유의미 변화 시에만 풀 결정 run 기동(2단
 *  에스컬레이션)으로 비용/과매매 방어 — 게이트 실배선은 P2d. */
export const LEVERAGE_TRIGGER_DEFAULT = '*/5 9-15 * * 1-5';

const LEVERAGE_DISCIPLINE = [
  '레버리지 투자 매뉴얼(ABCDE 신호 + LV형 배수 · docs/MIGRATION-capstone-leverage):',
  '- A 자산매력도 · B 손실깊이(vol 연동) · C R3 회복(5일 최고 종가) · D PSD 사전충격(K>=2 즉시 헤지) · E 충격반등.',
  '- 강세/중립 1.5x · R3 회복 1.75x · 약세 비회복 방어(현금/인버스) · PSD K>=2 인버스 헤지.',
  '계단식: 목표 비중을 국면/신호에 따라 단계적으로 올리고 내린다(한 번에 몰빵/전량 금지).',
  '다이나믹 손절: 고가 추적 트레일링(고가 -5% trim25 · -8% trim50 · -11.5% 전량 · 본전 아래로 내리지 마).',
  '현물수급 교차확인: 현물 외국인 순매수만으로 판단 금지 — 선물 미결제/풋콜(krx-futures/krx-options)과',
  '교차 확인해 divergence 를 해석한다(예: 현물 외인 순매수인데 선물발 프로그램 매도로 급락).',
].join('\n');

export interface LeverageContractOpts {
  goal?: string;
  focusSymbols?: string[];
  maxOrderKrw?: number | null;
  reviewMode?: ReviewMode;
  trigger?: string;
}

/** 레버리지 데이트레이딩 계약(P2 구현 대상·focused). */
export function buildLeverageContract(opts: LeverageContractOpts = {}): TradeContract {
  return {
    id: 'leverage-daytrade',
    goal: opts.goal
      ?? '레버리지 종목의 장중 계단식 진입/청산 — 현물수급·파생·뉴스 종합 디깅으로 상황 대응.',
    horizon: 'intraday',
    tools: [
      'finance_kr_flow',   // 파생(krx-futures/krx-options) + 장중(estimate/frgn-institution)
      'finance_quote',     // 레버 종목 실시간가
      'finance_capstone',  // ABCDE / LV 국면
      'finance_dig',       // 뉴스·매크로 순간 디깅
      'trailing_stops',    // 다이나믹 손절선 계산(디깅 신호로 변조)
      'submit_trade_decision',
    ],
    discipline: LEVERAGE_DISCIPLINE,
    focusSymbols: opts.focusSymbols ?? [...LEVERAGE_FOCUS_DEFAULT],
    maxOrderKrw: opts.maxOrderKrw === undefined ? 5_000_000 : opts.maxOrderKrw,
    reviewMode: opts.reviewMode ?? 'review-first',
    trigger: opts.trigger ?? LEVERAGE_TRIGGER_DEFAULT,
  };
}

// ── 자유 스윙 계약 (오픈월드 모멘텀 · 2026-07-10 · D1) ────────────────────────
// 대표 지시: 모멘텀 투자형 — 미/한 섹터·ETF·레버리지·BTC상품을 자유롭게 고르고, 눈에
// 띄는 상승을 따라가며(모멘텀), 외국인 순매수를 그림자처럼 추종한다. 전 프레임워크 신호
// 자유 활용·데이트레이딩. 환각 방지 위해 넓은 유니버스 화이트리스트(대표가 확장 가능).

/** 오픈월드 유니버스(넓은 화이트리스트) — 한/미 주요 ETF·레버리지·반도체·BTC ETF. 확장 가능. */
export const FREE_SWING_UNIVERSE = [
  // 한국 — 레버리지/인버스/섹터/미국추종 ETF + 반도체 대장주
  '122630.KO', '252670.KO', '091160.KO', '305720.KO', '379800.KO', '005930.KO', '000660.KO',
  // 미국 — 지수/레버리지 ETF + 반도체 + BTC ETF + 섹터
  'SPY.US', 'QQQ.US', 'TQQQ.US', 'SOXL.US', 'SOXX.US', 'KORU.US',
  'IBIT.US', 'BITO.US', 'NVDA.US', 'XLK.US', 'XLE.US',
] as const;

/** 자유 스윙 데이트레이딩 5분(대표 지시 2026-07-10 · 오픈월드 모멘텀). */
export const FREE_SWING_TRIGGER_DEFAULT = '*/5 9-15 * * 1-5';

const FREE_SWING_DISCIPLINE = [
  '자유 스윙(오픈월드 모멘텀) 규율:',
  '- 모멘텀 추종: 눈에 띄는 상승(신고가·거래량 급증·연속상승·강한 상대강도)을 따라간다. 하락 추격 금지.',
  '- 외국인 그림자: 외국인/기관 순매수 상위를 그림자처럼 추종(finance_kr_flow). 수급이 이탈하면 빠진다.',
  '- 자산매력도 커버: 특정 자산군 매력도가 오르면 주식계좌 내 상품으로 커버한다',
  '  (예: 비트코인 매력도 상승 → IBIT/BITO ETF · 반도체 강세 → SOXL/KODEX반도체).',
  '- 오픈월드: 유니버스 안에서 한/미·섹터·레버리지·BTC상품을 자유롭게 고른다(고정 종목 없음).',
  '- 데이트레이딩: 장중 진입/청산 자유. 단 모멘텀이 꺾이면(상대강도 약화·수급 이탈) 즉시 익절/손절.',
  '- 손절 엄격: 진입가 대비 -3~5% 또는 모멘텀 소멸 시 청산. 한 종목 몰빵 금지(분산).',
  '- 국면 상시 반영: finance_capstone 국면과 backbone 자산군 방향을 매 판단에 반영(risk-off면 축소).',
].join('\n');

export interface FreeSwingContractOpts {
  goal?: string;
  universe?: string[];
  maxOrderKrw?: number | null;
  reviewMode?: ReviewMode;
  trigger?: string;
}

/** 자유 스윙 계약(D1) — 오픈월드 모멘텀·외국인 그림자·전 프레임워크 신호·데이트레이딩. */
export function buildFreeSwingContract(opts: FreeSwingContractOpts = {}): TradeContract {
  return {
    id: 'free-swing',
    goal: opts.goal
      ?? '오픈월드 모멘텀 스윙 — 미/한 섹터·ETF·레버리지·BTC상품에서 눈에 띄는 상승을 외국인 수급 그림자로 따라간다.',
    horizon: 'intraday',
    tools: [
      'finance_trend',            // 자산군/섹터/국가 로테이션·모멘텀·상대강도
      'finance_market_backbone',  // 자산군 매력도(BTC·반도체 등)
      'finance_kr_flow',          // 외국인/기관 순매수(그림자 추종)
      'finance_quote',            // 실시간가·모멘텀
      'finance_capstone',         // 국면(risk-on/off)
      'finance_dig',              // 뉴스·모멘텀 촉매
      'submit_trade_decision',
    ],
    discipline: FREE_SWING_DISCIPLINE,
    focusSymbols: opts.universe ?? [...FREE_SWING_UNIVERSE],
    maxOrderKrw: opts.maxOrderKrw === undefined ? 3_000_000 : opts.maxOrderKrw,
    reviewMode: opts.reviewMode ?? 'autonomous',
    trigger: opts.trigger ?? FREE_SWING_TRIGGER_DEFAULT,
  };
}

/** 자유 스윙 계약 → 시스템 프롬프트. ASCII+한글. */
export function buildFreeSwingContractPrompt(c: TradeContract): string {
  const cap = c.maxOrderKrw == null ? '없음' : String(c.maxOrderKrw) + ' KRW';
  return [
    '너는 monad 의 자유 스윙(오픈월드 모멘텀) 트레이딩 결정 에이전트다. 계약 범위에서 자유롭게 판단한다.',
    '',
    '[목표] ' + c.goal,
    '[유니버스(이 안에서 자유 선택 · 이 밖은 금지)] ' + c.focusSymbols.join(', '),
    '[주문 상한] ' + cap + '  [리뷰 모드] ' + c.reviewMode,
    '',
    '[규율]',
    c.discipline,
    '',
    '[디깅 프로토콜] 결정 전에:',
    '1) finance_trend 로 자산군/섹터/국가 로테이션·모멘텀·상대강도(어디가 강한가).',
    '2) finance_market_backbone 로 자산군 매력도(BTC·반도체·에너지 등 어디로 자금이 도는가).',
    '3) finance_kr_flow 로 외국인/기관 순매수 상위(그림자 추종 대상).',
    '4) finance_quote 로 후보 종목 실시간가·모멘텀 확인.',
    '5) finance_capstone 으로 국면(risk-on/off) — off 면 노출 축소.',
    '6) (촉매) finance_dig 로 뉴스·매크로.',
    '자산매력도가 오르는 자산군을 유니버스 내 상품으로 커버한다(BTC->IBIT/BITO · 반도체->SOXL/KODEX반도체).',
    '',
    '[결정 방출 — 목표 방출형 · 필수]',
    '반드시 submit_trade_decision *도구를 호출*해서 결정을 방출하라. 텍스트로 쓰지 마라.',
    'action=hold(관망)여도 도구 호출(targets 비움). targets 심볼은 유니버스 안에서만.',
    '목표는 "목표 포지션(targetWeight 0~1 또는 targetKrw) + 손절선"만. 수량 직접 금지(코드가 delta 계산).',
    'rationale(모멘텀/수급 근거) · confidence(0~1 · 이번 기회의 확신도 — 오케스트레이터 동적 배분 입력) 필수.',
    '',
    '[안전] 너는 제안자다. 집행 인가는 mandate 게이트(armed/live/상한/세션). place_order 직접 호출 금지.',
    'confidence 는 정직하게 — 기회가 뚜렷할 때만 높게(오케스트레이터가 자금을 그쪽으로 기울인다).',
  ].join('\n');
}

/** 계약서 → 레버리지 결정 에이전트 시스템 프롬프트. ASCII+한글(truncation 회피). */
export function buildLeverageContractPrompt(c: TradeContract): string {
  const cap = c.maxOrderKrw == null ? '없음' : String(c.maxOrderKrw) + ' KRW';
  return [
    '너는 monad 의 레버리지 트레이딩 결정 에이전트다. 하나의 계약서(contract)를 받아 그 범위에서만 판단한다.',
    '',
    '[목표] ' + c.goal,
    '[대상 종목(화이트리스트 · 이 밖은 절대 건드리지 마)] ' + c.focusSymbols.join(', '),
    '[주문 상한] ' + cap + '  [리뷰 모드] ' + c.reviewMode,
    '',
    '[규율]',
    c.discipline,
    '',
    '[디깅 프로토콜] 결정 전에 반드시:',
    '1) finance_kr_flow 로 파생(krx-futures 선물 미결제 · krx-options 풋콜) + 장중 수급(estimate/frgn-institution) 조회.',
    '2) finance_quote 로 대상 종목 실시간가.',
    '3) finance_capstone 로 ABCDE/LV 국면.',
    '4) (필요시) finance_dig 로 뉴스·매크로.',
    '5) 보유/진입 종목의 손절선은 trailing_stops 도구로 계산한다(풋콜/국면/변동성을 넘겨 손절 폭 변조).',
    '현물수급과 파생을 교차 확인해 divergence 를 해석한다.',
    '',
    '[결정 방출 — 목표 방출형 · 필수]',
    '반드시 submit_trade_decision *도구를 호출*해서 결정을 방출하라. 텍스트/마크다운으로 쓰지 마라 —',
    '도구 호출이 아니면 결정으로 인정되지 않는다. action=hold(조정 없음)여도 반드시 도구를 호출한다(targets 비움).',
    '방출 내용은 "목표 포지션 + 손절선"만. 주문 수량을 직접 내지 마라(결정론 코드가 현 포지션과 diff 해 delta 계산).',
    'targets 심볼은 화이트리스트 안에서만. 근거(rationale) · 확신도(confidence 0~1) · 디깅 근거(digEvidence)를 포함.',
    '',
    '[안전] 너는 제안자다. 실제 집행 인가는 mandate 게이트가 한다(armed/live/상한/장중 세션).',
    'place_order 를 직접 부르지 마라. 지금은 dry 관측 단계 — 결정을 방출하면 된다.',
  ].join('\n');
}
