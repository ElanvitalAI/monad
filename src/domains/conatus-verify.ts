// ── Conatus verify-gate 불변식 포트 (READ-ONLY · Layer 1 hard-gate) ───────────
//
// Conatus python 검증 게이트 4종의 **불변식 로직**을 TS 로 충실 포트한다.
//   · verify_risk_bounds.py  → verifyRiskBounds   (PURE config · 브로커 무접촉)
//   · verify_position.py     → verifyPosition     (실보유 ↔ 기대 매니페스트)
//   · verify_exposure.py     → verifyExposure     (노출비율 상한)
//   · verify_order_filled.py → verifyOrderFilled  (의도 ↔ 실체결)
//
// ⚠️ 머니패스 인접 — 하드 제약(절대 위반 금지):
//   · READ-ONLY. 주문 접수 0 · 브로커/라이브 write 0 · ~/.monad/conatus write 0.
//   · trade-order-adapters.ts / trade-*.ts / finance-tools.ts 무접촉(additive only).
//   · 실집행 경로는 계속 python. 이 모듈은 순수 판정 함수 + 얇은 조회 어댑터뿐.
//
// 설계: 불변식은 전부 PURE 함수 `(brokerData, stateConfig) => verdict`.
//   데이터 fetch(kr-flow skill `--json`)는 별개의 얇은 READ-ONLY 어댑터로 분리 →
//   순수 함수는 라이브 호출 없이 픽스처로 테스트 가능(결정론).
//
// exit-code 파리티: 각 결과의 `code` 는 python 스크립트의 exit code 시맨틱과 동형.
//   0 = 통과 · 1 = 위반/드리프트/BREACH/불일치 · 2 = config/매니페스트/의도 없음·손상
//   (fail-closed) · 3 = 브로커 조회 실패/순자산 판정불가(fail-closed).
//   fail-closed 원칙: 현실을 판정할 수 없으면 통과가 아니라 **차단**.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONATUS_DIR, conatusEnv } from './conatus-env.js';

// ── 공용: exit-code 시맨틱 ────────────────────────────────────────────────
/** python 게이트 exit code 동형. */
export type GateCode = 0 | 1 | 2 | 3;

/** python `int(float(x))` 동형(비수치 → 0). */
function toInt(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
/** python `float(x)` 동형(비수치 → NaN 대신 0 fallback은 호출부 판단). */
function toFloat(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// ══════════════════════════════════════════════════════════════════════════
// I. verifyRiskBounds — 리스크 불변식 (PURE config · 브로커 무접촉)
//    verify_risk_bounds.py _check_invariants 충실 포트.
// ══════════════════════════════════════════════════════════════════════════

export interface RiskBoundsConfig {
  breakeven_usd?: number;
  active_full_exit_stop_usd?: number;
  trailing_stops_usd?: Record<string, number>;
}

export interface RiskBoundsResult {
  ok: boolean;
  /** 0=통과 · 1=불변식 위반 · 2=config 없음/손상(fail-closed). */
  code: 0 | 1 | 2;
  violations: string[];
}

/**
 * 불변식 위반 목록(빈 배열 = 통과). verify_risk_bounds.py `_check_invariants` 동형.
 *   I1. 전량 손절선 ≥ 본전 (원금 손실 불가 · 협상 불가).
 *   I2. 손절 사다리 단조 하강 trim25 > trim50 > full_exit + 사다리 full_exit ≥ 본전.
 */
export function checkRiskInvariants(cfg: RiskBoundsConfig): string[] {
  const v: string[] = [];
  const be = cfg.breakeven_usd;
  const fullExit = cfg.active_full_exit_stop_usd;

  // I1. 전량 손절선 ≥ 본전 (python: be is None or full_exit is None)
  if (be == null || fullExit == null) {
    v.push('config 불완전: breakeven_usd / active_full_exit_stop_usd 필요');
    return v;
  }
  if (fullExit < be) {
    v.push(`I1 위반: 전량 손절선 $${fullExit} < 본전 $${be} (원금 손실 불가 · 협상 불가)`);
  }

  // I2. 트레일 사다리 단조 하강 (선언된 경우)
  const tr = cfg.trailing_stops_usd;
  if (tr && typeof tr === 'object' && ['trim25', 'trim50', 'full_exit'].every((k) => k in tr)) {
    const a = tr.trim25;
    const b = tr.trim50;
    const c = tr.full_exit;
    if (!(a > b && b > c)) {
      v.push(`I2 위반: 손절 사다리 비단조 (trim25 ${a} > trim50 ${b} > full_exit ${c} 이어야)`);
    }
    // 사다리 전량선도 본전 이상이어야 (I1 과 정합)
    if (c < be) {
      v.push(`I2 위반: 사다리 full_exit $${c} < 본전 $${be}`);
    }
  }
  return v;
}

/**
 * 리스크 불변식 게이트. `cfg === null` = config 없음/손상 → code 2(fail-closed).
 * verify_risk_bounds.py `cmd_check` 동형(exit 0/1/2 → code).
 */
export function verifyRiskBounds(cfg: RiskBoundsConfig | null): RiskBoundsResult {
  if (cfg == null) {
    return { ok: false, code: 2, violations: ['config 없음/손상 (risk_bounds.json 선언 필요)'] };
  }
  const violations = checkRiskInvariants(cfg);
  if (violations.length > 0) return { ok: false, code: 1, violations };
  return { ok: true, code: 0, violations: [] };
}

// ══════════════════════════════════════════════════════════════════════════
// II. verifyPosition — 실보유 ↔ 기대 매니페스트
//     verify_position.py `cmd_check` 충실 포트.
// ══════════════════════════════════════════════════════════════════════════

export interface PositionsManifest {
  positions: Record<string, number>;
  account?: string;
  as_of?: string;
}

export interface PositionResult {
  ok: boolean;
  /** 0=정합 · 1=드리프트 · 2=매니페스트 없음/손상 · 3=브로커 조회 실패(fail-closed). */
  code: GateCode;
  drift: string[];
}

/**
 * 실보유 ↔ 기대 대조. `actualHoldings===null` = 브로커 조회 실패(code 3),
 * `manifest===null` = 매니페스트 없음/손상(code 2). python 순서(매니페스트 먼저
 * 판정 → 브로커) 그대로: 둘 다 실패면 2 반환.
 *
 * @param actualHoldings {symbol: qty}. GET-only 조회 결과. null = 조회 실패.
 * @param manifest 기대 매니페스트. null = 파일 없음/손상.
 */
export function verifyPosition(
  actualHoldings: Record<string, number> | null,
  manifest: PositionsManifest | null,
): PositionResult {
  // python cmd_check: 매니페스트를 먼저 검사(code 2) → 그 다음 브로커(code 3).
  if (manifest == null) {
    return { ok: false, code: 2, drift: ['기대 매니페스트 없음/손상 (먼저 --snapshot baseline 선언)'] };
  }
  if (actualHoldings == null) {
    return { ok: false, code: 3, drift: ['브로커 조회 실패 (현실 관측 불가 · fail-closed)'] };
  }
  const expected = manifest.positions ?? {};
  const violations: string[] = [];

  // ① 기대 종목: 수량 정합
  for (const [sym, expQty] of Object.entries(expected)) {
    const actQty = actualHoldings[sym] ?? 0;
    if (toInt(expQty) !== actQty) {
      violations.push(`${sym}: 기대 ${expQty}주 != 실보유 ${actQty}주`);
    }
  }
  // ② 미선언 보유: 계좌에 있는데 매니페스트에 없는 종목(qty>0) = 적신호
  for (const [sym, actQty] of Object.entries(actualHoldings)) {
    if (actQty > 0 && !(sym in expected)) {
      violations.push(`${sym}: 미선언 보유 ${actQty}주 (매니페스트에 없음)`);
    }
  }

  if (violations.length > 0) return { ok: false, code: 1, drift: violations };
  return { ok: true, code: 0, drift: [] };
}

// ══════════════════════════════════════════════════════════════════════════
// III. verifyExposure — 노출 비율 상한
//      verify_exposure.py `compute_exposure` + main 판정 로직 충실 포트.
// ══════════════════════════════════════════════════════════════════════════

export interface ExposurePolicy {
  gross_cap_pct?: number;
  /** null/0/미지정 = per-symbol 상한 무제한. */
  per_symbol_cap_pct?: number | null;
  leverage?: Record<string, number>;
  /** 'block' = BREACH 시 차단(code 1) · 'warn' = 통과(code 0). 기본 block. */
  on_breach?: string;
}

/** 노출 계산에 쓰이는 보유 1행(수량만 필요 · 가격은 prices 맵에서). */
export interface ExposureHolding {
  symbol: string;
  quantity: number;
}

export interface ExposureResult {
  ok: boolean;
  /** 0=상한 이내 · 1=BREACH(block) · 2=config 없음/손상 · 3=순자산 판정불가(fail-closed). */
  code: GateCode;
  /** effective/equity (순수 비율 · 분수). ratioPct = ratio*100. */
  ratio: number;
  /** effective/equity*100 (python `ratio` 출력값 · gross_cap_pct 와 동일 스케일). */
  ratioPct: number;
  effective: number;
  equity: number;
  perSymbol: Record<string, { value: number; leverage: number; effective: number }>;
  breaches: string[];
}

/**
 * 노출 비율 상한 게이트. `policy===null` = config 없음/손상(code 2, fail-closed).
 * 순자산(equity) ≤ 0 = 판정불가(code 3, fail-closed).
 *
 *   equity    = Σ(qty × price) + cash
 *   effective = Σ(value × leverage[symbol]; 미지정=1)
 *   ratioPct  = effective / equity × 100  →  > gross_cap_pct 또는 종목당 상한 초과 = BREACH
 *
 * verify_exposure.py 와 동형: qty ≤ 0 종목 skip · leverage 미지정=1 · per_symbol_cap
 * falsy면 종목당 검사 skip · on_breach!=='block' 이면 BREACH 라도 통과(code 0).
 *
 * @param holdings 보유 종목(수량). @param prices {symbol: lastPrice}.
 * @param cashBuyingPower 현금(cashBuyingPower). @param policy 노출 정책. null=없음/손상.
 */
export function verifyExposure(
  holdings: ExposureHolding[],
  prices: Record<string, number>,
  cashBuyingPower: number,
  policy: ExposurePolicy | null,
): ExposureResult {
  const empty = { ratio: 0, ratioPct: 0, effective: 0, equity: 0, perSymbol: {} };
  if (policy == null) {
    return { ok: false, code: 2, breaches: ['config 없음/손상 (fail-closed)'], ...empty };
  }
  const cap = toFloat(policy.gross_cap_pct ?? 150);
  const perSymCap = policy.per_symbol_cap_pct; // null/0 = 무제한
  const leverage = policy.leverage ?? {};
  const onBreach = policy.on_breach ?? 'block';

  let totalValue = 0;
  let effective = 0;
  const perSymbol: Record<string, { value: number; leverage: number; effective: number }> = {};
  for (const it of holdings) {
    const sym = it.symbol;
    const qty = toInt(it.quantity);
    if (!sym || qty <= 0) continue; // python: qty<=0 skip
    const price = toFloat(prices[sym]);
    const value = qty * price;
    const lev = toFloat(leverage[sym] ?? 1);
    totalValue += value;
    const eff = value * lev;
    effective += eff;
    perSymbol[sym] = { value, leverage: lev, effective: eff };
  }
  const equity = totalValue + cashBuyingPower;

  if (equity <= 0) {
    // python: 순자산 0/음수 → fail-closed(3)
    return { ok: false, code: 3, breaches: ['순자산 0/음수 (fail-closed)'], ratio: 0, ratioPct: 0, effective, equity, perSymbol };
  }

  const ratioPct = (effective / equity) * 100;
  const breaches: string[] = [];
  let breachReason: string | null = null;
  if (ratioPct > cap) {
    breachReason = `총 노출 ${ratioPct.toFixed(1)}% > 상한 ${cap.toFixed(0)}%`;
  } else if (perSymCap) {
    for (const [sym, d] of Object.entries(perSymbol)) {
      const r = (d.effective / equity) * 100;
      if (r > toFloat(perSymCap)) {
        breachReason = `종목 ${sym} ${r.toFixed(1)}% > 종목당 ${perSymCap}%`;
        break;
      }
    }
  }

  const base = { ratio: effective / equity, ratioPct, effective, equity, perSymbol };
  if (breachReason) {
    breaches.push(breachReason);
    if (onBreach === 'block') return { ok: false, code: 1, breaches, ...base };
    // warn: BREACH 지만 통과 (python: return 0)
    return { ok: true, code: 0, breaches, ...base };
  }
  return { ok: true, code: 0, breaches: [], ...base };
}

// ══════════════════════════════════════════════════════════════════════════
// IV. verifyOrderFilled — 의도 ↔ 실체결
//     verify_order_filled.py `_match` / `_verify_one` / `cmd_check` 충실 포트.
// ══════════════════════════════════════════════════════════════════════════

export interface OrderIntent {
  orderId?: string;
  symbol?: string;
  side?: string;
  quantity?: number;
}

export interface BrokerOrder {
  orderId?: string;
  symbol?: string;
  side?: string;
  quantity?: number;
  status?: string;
  execution?: { filledQuantity?: number } | null;
}

export interface OrderFilledResult {
  ok: boolean;
  /** 0=전부 FILLED+수량정합 · 1=미체결/불일치 · 2=의도 없음/손상 · 3=브로커 조회 실패. */
  code: GateCode;
  mismatches: string[];
}

/**
 * 의도 1건에 대응하는 브로커 주문 찾기 — orderId 우선, 없으면 (symbol,side,qty) 최신.
 * verify_order_filled.py `_match` 동형(CLOSED 응답은 최신순 가정 · 첫 매칭 반환).
 */
export function matchOrder(intent: OrderIntent, orders: BrokerOrder[]): BrokerOrder | null {
  const oid = intent.orderId;
  if (oid) {
    return orders.find((o) => o.orderId === oid) ?? null;
  }
  for (const o of orders) {
    if (
      o.symbol === intent.symbol &&
      o.side === intent.side &&
      toInt(o.quantity ?? 0) === toInt(intent.quantity ?? -1)
    ) {
      return o;
    }
  }
  return null;
}

/** 위반 사유 반환(null = 통과). verify_order_filled.py `_verify_one` 동형. */
export function verifyOneOrder(intent: OrderIntent, order: BrokerOrder | null): string | null {
  const tag = intent.orderId || `${intent.symbol}/${intent.side}/${intent.quantity}주`;
  if (order === null) {
    return `${tag}: 체결 이력에 없음 (미접수/미체결 가능)`;
  }
  if (order.status !== 'FILLED') {
    return `${tag}: status=${order.status} (FILLED 아님)`;
  }
  const want = toInt(intent.quantity ?? -1);
  const got = toInt((order.execution ?? {})?.filledQuantity ?? 0);
  if (want >= 0 && got !== want) {
    return `${tag}: 체결수량 ${got} != 선언 ${want} (부분체결/불일치)`;
  }
  return null;
}

/**
 * 의도 ↔ 실체결 게이트. `intents===null` = 의도 파일 없음/손상(code 2),
 * `brokerOrders===null` = 브로커 조회 실패(code 3). python 순서: 의도 먼저(2) →
 * 빈 배열 통과(0) → 브로커(3). 명시적 빈 배열 = 검증할 주문 없음 → 통과.
 *
 * @param brokerOrders CLOSED 체결 이력(최신순). null = 조회 실패.
 * @param intents 집행 의도 목록. null = 파일 없음/손상.
 */
export function verifyOrderFilled(
  brokerOrders: BrokerOrder[] | null,
  intents: OrderIntent[] | null,
): OrderFilledResult {
  if (intents == null) {
    return { ok: false, code: 2, mismatches: ['의도 파일 없음/손상 (집행 시 --declare 선언 필요)'] };
  }
  if (intents.length === 0) {
    return { ok: true, code: 0, mismatches: [] }; // 명시적 빈 선언 = 검증할 주문 없음
  }
  if (brokerOrders == null) {
    return { ok: false, code: 3, mismatches: ['브로커 조회 실패 (fail-closed)'] };
  }
  const mismatches: string[] = [];
  for (const intent of intents) {
    const reason = verifyOneOrder(intent, matchOrder(intent, brokerOrders));
    if (reason) mismatches.push(reason);
  }
  if (mismatches.length > 0) return { ok: false, code: 1, mismatches };
  return { ok: true, code: 0, mismatches: [] };
}

// ══════════════════════════════════════════════════════════════════════════
// V. READ-ONLY 상태 config 리더 (~/source/conatus/screener/*.json)
//    CONATUS_DIR 단일출처(conatus-env.ts) 재사용. 전부 READ-ONLY · fail → null.
// ══════════════════════════════════════════════════════════════════════════

/** Conatus screener 디렉토리(상태 config·매니페스트 소재). READ-ONLY. */
export function screenerDir(): string {
  return join(CONATUS_DIR, 'screener');
}

/** screener/<name> 을 파싱(READ-ONLY). 파일 없음/손상 → null(fail-closed). */
function readScreenerJson<T>(name: string): T | null {
  const p = join(screenerDir(), name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** risk_bounds.json → RiskBoundsConfig | null. */
export function readRiskBounds(): RiskBoundsConfig | null {
  return readScreenerJson<RiskBoundsConfig>('risk_bounds.json');
}
/** positions_expected.json → PositionsManifest | null. */
export function readPositionsExpected(): PositionsManifest | null {
  return readScreenerJson<PositionsManifest>('positions_expected.json');
}
/** exposure_policy.json → ExposurePolicy | null. */
export function readExposurePolicy(): ExposurePolicy | null {
  return readScreenerJson<ExposurePolicy>('exposure_policy.json');
}
/** orders_intent.json → OrderIntent[] | null (파일의 `orders` 배열). */
export function readOrdersIntent(): OrderIntent[] | null {
  const doc = readScreenerJson<{ orders?: OrderIntent[] }>('orders_intent.json');
  if (doc == null) return null;
  return Array.isArray(doc.orders) ? doc.orders : null;
}

// ══════════════════════════════════════════════════════════════════════════
// VI. 얇은 READ-ONLY 브로커 데이터 어댑터 (kr-flow skill `--json`)
//     ⚠️ 라이브·비결정론 — 순수 함수와 분리. 유닛테스트는 순수함수만.
//     GET-only: toss-holdings / toss-power / toss-orders. 주문 접수 0.
// ══════════════════════════════════════════════════════════════════════════

const KR_FLOW_MAIN = join(homedir(), '.claude', 'skills', 'kr-flow', 'scripts', 'main.py');

/** kr-flow CLI 를 `--json` 으로 실행하고 파싱(READ-ONLY GET). 실패 시 예외 전파. */
function krFlowJson(args: string[]): any {
  const out = execFileSync('python3', [KR_FLOW_MAIN, ...args, '--json'], {
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 8_000_000,
    env: { ...process.env, ...conatusEnv() }, // 토스 자격(READ-ONLY)
  });
  return JSON.parse(out.trim());
}

/** toss-holdings --json → {items:[{symbol,quantity,lastPrice,rate}], ...}. */
export function fetchHoldingsRaw(): { items: Array<{ symbol: string; quantity: number; lastPrice: number; rate: number }> } {
  return krFlowJson(['toss-holdings']);
}
/** toss-power --json → {cashBuyingPower}. */
export function fetchCashBuyingPower(): number {
  return toInt(krFlowJson(['toss-power']).cashBuyingPower);
}
/** toss-orders <status> --json → {status, orders:[...]}. status=OPEN|CLOSED. */
export function fetchOrdersRaw(status: 'OPEN' | 'CLOSED' = 'CLOSED'): { status: string; orders: BrokerOrder[] } {
  return krFlowJson(['toss-orders', status]);
}

/** 실보유 → {symbol: qty} (verifyPosition 입력). 어댑터. */
export function fetchActualHoldings(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of fetchHoldingsRaw().items) {
    if (it.symbol) out[it.symbol] = toInt(it.quantity);
  }
  return out;
}

/** 실보유 → verifyExposure 입력(holdings 배열 + prices 맵). 어댑터. */
export function fetchExposureInputs(): { holdings: ExposureHolding[]; prices: Record<string, number> } {
  const holdings: ExposureHolding[] = [];
  const prices: Record<string, number> = {};
  for (const it of fetchHoldingsRaw().items) {
    if (!it.symbol) continue;
    holdings.push({ symbol: it.symbol, quantity: toInt(it.quantity) });
    prices[it.symbol] = toFloat(it.lastPrice);
  }
  return { holdings, prices };
}
