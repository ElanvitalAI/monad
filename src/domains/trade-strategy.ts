// ── 자율 매매 전략 엔진 (2026-07-07 · 2슬롯 · DRY 계산) ────────────────
//
// 대표 지시: 2:1 두 슬롯 — A(삼성 캡스톤 선제방어형) : B(한국장 레버리지 스윙).
// 각 슬롯 규칙으로 target 배분 → 현 포지션 대조 → delta 주문(intent) 생성.
// 순수 계산(주문 없음) — 생성된 intent는 executeAutonomousTrade(mandate 게이트)로.
//
// 기존 신호 로직 재사용: 슬롯 A는 capstone 국면(capstone_signals.json/decideLeverage),
// 슬롯 B는 leverage_playbook(과도폭락 조건부 — 평시 현금대기·진입은 신호 주입).
// ★ 이 파일은 계산만. 실주문/arming은 mandate armed/live + executor(전부 disarmed 기본).

import type { SynthWeights } from './capstone-leverage.js';
import type { TradeMandate } from './trade-mandate.js';

export interface TargetLeg { symbol: string; role: string; slot: 'A' | 'B'; targetKrw: number }
export interface PositionRow { symbol: string; shares: number; price: number }
export interface DeltaOrder { symbol: string; side: 'buy' | 'sell'; qty: number; slot: string; reason: string; role?: string }

/** 심볼 정규화 — 005930.KO→005930 · KORU.US→KORU. */
export function normSym(s: string): string {
  return s.replace(/\.(KO|KS|KQ|US)$/i, '').toUpperCase().trim();
}

/** 슬롯 A — 캡스톤 국면 → 합성 weights(선제방어형 4 + LV형 근사). decideLeverage 매핑. */
export function slotAWeights(regime: string): SynthWeights {
  switch (regime) {
    case 'PSD_-1X': case 'PSD_-1_25X': return { stock: 0, lev2x: 0, inverse2x: 0.5, cash: 0.5 }; // 🚨 헤지
    case 'BEAR_CASH': case 'BEAR_-0_25X': return { stock: 0, lev2x: 0, inverse2x: 0, cash: 1 };    // 약세 현금
    case 'R3_1X': case 'BULL_1X': return { stock: 1, lev2x: 0, inverse2x: 0, cash: 0 };            // 본주 100%
    case 'BULL_1_5X': return { stock: 0, lev2x: 0.5, inverse2x: 0, cash: 0.5 };                     // LV 1.5x 근사
    case 'R3_1_75X': return { stock: 0, lev2x: 0.75, inverse2x: 0, cash: 0.25 };                    // LV 1.75x 근사
    default: return { stock: 0, lev2x: 0, inverse2x: 0, cash: 1 };                                  // 미상 → 현금(fail-safe)
  }
}

/** 슬롯 A 자본(KRW) = 총자본 × A/(A+B). */
export function slotACapital(m: TradeMandate): number {
  const a = m.slots.samsungCapstone.ratio, b = m.slots.koreaLeverage.ratio;
  return Math.round(m.totalCapitalKrw * a / (a + b));
}
export function slotBCapital(m: TradeMandate): number {
  const a = m.slots.samsungCapstone.ratio, b = m.slots.koreaLeverage.ratio;
  return Math.round(m.totalCapitalKrw * b / (a + b));
}

/** 슬롯 A target legs — 국면 weights × A자본. cash는 leg 없음(암묵). */
export function slotATargets(m: TradeMandate, regime: string): TargetLeg[] {
  const cap = slotACapital(m);
  const w = slotAWeights(regime);
  const s = m.slots.samsungCapstone.symbols;
  const legs: TargetLeg[] = [];
  if (w.stock > 0) legs.push({ symbol: s.stock, role: 'stock', slot: 'A', targetKrw: Math.round(cap * w.stock) });
  if (w.lev2x > 0) legs.push({ symbol: s.lev2x, role: 'lev2x', slot: 'A', targetKrw: Math.round(cap * w.lev2x) });
  if (w.inverse2x > 0) legs.push({ symbol: s.inverse2x, role: 'inverse2x', slot: 'A', targetKrw: Math.round(cap * w.inverse2x) });
  return legs;
}

/** 슬롯 B stance — 레버리지 플레이북. 평시 entered=false(현금대기). 진입 시 심볼별 target. */
export interface KoreaStance { entered: boolean; targetKrwBySymbol?: Record<string, number>; note?: string }

/** 슬롯 B target legs — 과도폭락 진입 시에만 레버리지 target. 평시 [](현금). */
export function slotBTargets(m: TradeMandate, stance: KoreaStance): TargetLeg[] {
  if (!stance.entered) return [];
  const legs: TargetLeg[] = [];
  for (const sym of m.slots.koreaLeverage.symbols) {
    const krw = stance.targetKrwBySymbol?.[normSym(sym)] ?? stance.targetKrwBySymbol?.[sym] ?? 0;
    if (krw > 0) legs.push({ symbol: sym, role: 'leverage', slot: 'B', targetKrw: Math.round(krw) });
  }
  return legs;
}

/** target legs vs 현 포지션 → delta 주문. 소액 미만·가격없음은 스킵(먼지·fail-safe). */
export function computeDeltaOrders(
  targets: TargetLeg[], positions: PositionRow[], prices: Record<string, number>,
  opts: { minKrw?: number } = {},
): DeltaOrder[] {
  const minKrw = opts.minKrw ?? 50_000;
  const targetBySym = new Map(targets.map(t => [normSym(t.symbol), t]));
  const priceOf = (sym: string) => prices[sym] ?? prices[normSym(sym)] ?? 0;
  const allSyms = new Set([...targets.map(t => normSym(t.symbol)), ...positions.map(p => normSym(p.symbol))]);
  const orders: DeltaOrder[] = [];
  for (const sym of allSyms) {
    const price = priceOf(sym);
    if (!(price > 0)) continue; // 가격 미상 → 스킵(fail-safe)
    const targetKrw = targetBySym.get(sym)?.targetKrw ?? 0;                 // target 없으면 0(=청산)
    const pos = positions.find(p => normSym(p.symbol) === sym);
    const currentKrw = (pos?.shares ?? 0) * price;
    const deltaKrw = targetKrw - currentKrw;
    if (Math.abs(deltaKrw) < minKrw) continue;
    const qty = Math.floor(Math.abs(deltaKrw) / price);
    if (qty < 1) continue;
    orders.push({
      symbol: sym, side: deltaKrw > 0 ? 'buy' : 'sell', qty,
      slot: targetBySym.get(sym)?.slot ?? (pos ? '청산' : '?'),
      reason: `target ${Math.round(targetKrw).toLocaleString()} vs 현재 ${Math.round(currentKrw).toLocaleString()} (Δ${Math.round(deltaKrw).toLocaleString()})`,
      // ★ role 보존(inverse2x 헤지 vs stock/lev2x 롱리스크 구분 — checker gap 축). 청산=undefined(항상 매도).
      ...(targetBySym.get(sym)?.role ? { role: targetBySym.get(sym)!.role } : {}),
    });
  }
  return orders;
}
