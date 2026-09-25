#!/usr/bin/env bun
// ── Price Guard Cycle — 단일 시세 스냅샷 수집 루프 (READ-ONLY) ──────────────────
//
// 한 사이클에서 ① 고정 감시 대상 + 현재 보유자산을 하나의 정규화된 심볼 집합으로 합치고,
// ② 심볼별 시세를 정확히 1회만 조회하며, ③ 보유 메타데이터·기존 트레일링 state·국면 벡터를
// 결합한 스냅샷을 만들어 ④ src/domains/price-guard-policy.ts 의 순수 판정을 호출한다.
//
// 안전: 무매매·무주문. 시세/상태 조회만. 수집 실패는 심볼별 구조화 오류로 격리되어
//   다른 심볼 판정을 중단하지 않는다(fail-soft per symbol).

import { omniQuote } from '../src/domains/finance-tools.js';
import { openRegimeDb, latestRegimeVector, recentRegimeVectors } from '../src/domains/regime-store.js';
import { decidePriceGuard, type PriceGuardDecision } from '../src/domains/price-guard-policy.js';
import type { RegimeVector } from '../src/domains/regime-synth.js';
import { priceObservationToSignal, priceMomentumToSignal } from '../src/domains/price-guard-signal.js';
import type { Signal } from '../src/domains/signal-pool.js';

/** 항상 감시하는 고정 대상(삼성전자·KODEX 국고채·KORU·삼성 콜/풋 워런트). */
export const FIXED_WATCH_TARGETS: readonly string[] = ['005930', '122630', 'KORU', '0193W0', '0193L0'];

/** 브로커 실보유 1건 + 기존 트레일링/래더 state 메타. */
export interface HoldingMeta {
  symbol: string;
  shares: number;
  entryPrice?: number;
  highwater?: number;
  firedLadder?: number[];
}

/** 정규화·중복 제거된 사이클 대상 1건. */
export interface PriceGuardTarget {
  /** 정규화된 심볼(공급자 호출 키). */
  symbol: string;
  /** 보유 여부. */
  held: boolean;
  /** 보유 수량(미보유=0). */
  shares: number;
  /** 결합된 보유 메타(있으면). */
  holding?: HoldingMeta;
}

/** 시세 공급자 1회 응답(omniQuote 구조호환). */
export interface QuoteResult {
  close: number;
  changePct: number;
  high: number;
  previousClose: number;
}

export type QuoteFn = (symbol: string) => QuoteResult | null;

/** 정책 판정에 필요한 것까지 결합된 심볼 1개의 사이클 스냅샷. */
export interface PriceGuardSnapshot {
  symbol: string;
  /** 현재가. */
  price: number;
  /** 기준(전일 종가) 가격. */
  referencePrice: number;
  /** 수집 시각(ISO). */
  timestamp: string;
  /** 보유 여부. */
  held: boolean;
  shares: number;
  /** 정책이 소비하는 기존(legacy) 트레일링/래더 state. */
  state: { highwater: number; entryPrice: number; firedLadder: number[] };
  /** 최신 국면 벡터(capstone 판정용). */
  regime: RegimeVector | null;
  /** 직전 국면 벡터(전환 판정용). */
  previousRegime: RegimeVector | null;
  /** 1h 모멘텀(급락/급등) — 롤링 이력 대비. 이력 부족이면 null(무포지션 움직임 알림용·2026-07-15). */
  momentum1h?: import('../src/domains/price-history.js').MomentumResult | null;
}

/** 심볼별 구조화 수집 오류(격리). */
export interface SnapshotError {
  symbol: string;
  stage: 'quote' | 'state' | 'unknown';
  error: string;
}

/** 한 사이클의 결과. */
export interface PriceGuardCycleResult {
  snapshots: PriceGuardSnapshot[];
  decisions: PriceGuardDecision[];
  errors: SnapshotError[];
  /** 심볼별 시세 공급자 호출 횟수(단위테스트 검증용). */
  quoteCallCount: Record<string, number>;
}

/** 주입 의존성(라이브/mock 스위치). */
export interface PriceGuardCycleDeps {
  quote: QuoteFn;
  latestRegime: () => RegimeVector | null;
  previousRegime?: () => RegimeVector | null;
  now?: () => string;
}

/** 심볼 정규화: 공백 제거 + 대문자화. 빈 문자열은 무효. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * 고정 감시 대상 + 현재 보유자산을 하나의 정규화된 심볼 집합으로 합친다.
 * 심볼 정규화 뒤 Map 으로 중복을 제거해 공급자 호출이 사이클당 심볼별 1회만 되도록 보장한다.
 * 보유 메타가 있는 심볼은 held=true 로 결합된다.
 */
export function buildTargetSet(
  fixed: readonly string[],
  holdings: readonly HoldingMeta[],
): PriceGuardTarget[] {
  const bySymbol = new Map<string, PriceGuardTarget>();

  for (const raw of fixed) {
    const symbol = normalizeSymbol(raw);
    if (!symbol || bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, { symbol, held: false, shares: 0 });
  }

  for (const holding of holdings) {
    const symbol = normalizeSymbol(holding.symbol);
    if (!symbol) continue;
    const merged: HoldingMeta = { ...holding, symbol };
    const existing = bySymbol.get(symbol);
    if (existing) {
      existing.held = true;
      existing.shares = holding.shares;
      existing.holding = merged;
    } else {
      bySymbol.set(symbol, { symbol, held: true, shares: holding.shares, holding: merged });
    }
  }

  return [...bySymbol.values()];
}

/** 보유 메타 → 정책이 소비하는 legacy state. 미보유/미상은 현재가 기준 보수 기본값. */
function stateFromHolding(holding: HoldingMeta | undefined, current: number): {
  highwater: number; entryPrice: number; firedLadder: number[];
} {
  return {
    highwater: holding?.highwater ?? current,
    entryPrice: holding?.entryPrice ?? current,
    firedLadder: holding?.firedLadder ?? [],
  };
}

/**
 * 한 사이클의 단일 시세 스냅샷 수집 루프.
 * 대상 집합 생성 → 심볼별 1회 시세 조회 → 보유 메타·기존 state·국면 결합 → 정책 호출.
 * 수집 실패는 심볼별 구조화 오류로 격리되어 다른 심볼 판정을 중단하지 않는다.
 */
export function runPriceGuardCycle(
  deps: PriceGuardCycleDeps,
  holdings: readonly HoldingMeta[] = [],
  fixed: readonly string[] = FIXED_WATCH_TARGETS,
): PriceGuardCycleResult {
  const targets = buildTargetSet(fixed, holdings);
  const now = deps.now?.() ?? new Date().toISOString();

  let regime: RegimeVector | null = null;
  let previousRegime: RegimeVector | null = null;
  const errors: SnapshotError[] = [];
  try {
    regime = deps.latestRegime();
    previousRegime = deps.previousRegime?.() ?? null;
  } catch (e) {
    // 국면 조회 실패는 치명적이지 않다 — capstone 만 건너뛴다.
    regime = null;
    previousRegime = null;
    errors.push({ symbol: '*', stage: 'state', error: errMsg(e) });
  }

  const snapshots: PriceGuardSnapshot[] = [];
  const decisions: PriceGuardDecision[] = [];
  const quoteCallCount: Record<string, number> = {};

  for (const target of targets) {
    try {
      quoteCallCount[target.symbol] = (quoteCallCount[target.symbol] ?? 0) + 1;
      const q = deps.quote(target.symbol);
      if (!q || typeof q.close !== 'number') {
        errors.push({ symbol: target.symbol, stage: 'quote', error: 'no quote returned' });
        continue;
      }

      const state = stateFromHolding(target.holding, q.close);
      const snapshot: PriceGuardSnapshot = {
        symbol: target.symbol,
        price: q.close,
        referencePrice: q.previousClose,
        timestamp: now,
        held: target.held,
        shares: target.shares,
        state,
        regime,
        previousRegime,
      };
      snapshots.push(snapshot);

      decisions.push(decidePriceGuard({
        symbol: snapshot.symbol,
        current: snapshot.price,
        state: snapshot.state,
        previousRegime: snapshot.previousRegime,
        regime: snapshot.regime,
        held: snapshot.held,  // 미보유면 청산/트림/래더 트리거 억제(유령매도 방어)
      }));
    } catch (e) {
      errors.push({ symbol: target.symbol, stage: 'unknown', error: errMsg(e) });
    }
  }

  return { snapshots, decisions, errors, quoteCallCount };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── 라이브 배선 ──────────────────────────────────────────────────────────────
// 실제 사이클: omniQuote(시세) + regime.db(국면). 보유자산은 호출 측에서 주입.
/** ★ 미배선 갭 수습(대표 2026-07-13) — 스냅샷을 Signal 로 도출해 SignalPool 에 인입(순수 배선·
 *  테스트 가능). priceObservationToSignal 은 critical 트리거일 때만 Signal 반환(스팸 없음·실제
 *  보호 사건만). 인입 후엔 기존 gate1(asset+급락→S4)/gate2/router 크론이 이어받아 텔레그램 알림
 *  → "2026-07-13 급락 미탐"의 근본(감지→S4→router dead)을 닫는다. 이전엔 크론이 JSON 출력만 하고
 *  이 배선이 없어 어댑터가 프로덕션에서 dead-code 였다(test 만 통과·production wire 부재). */
export function ingestPriceGuardSignals(
  result: PriceGuardCycleResult,
  pool: { ingest: (s: Signal) => { inserted: boolean } },
): { signals: number; ingested: number } {
  // 보호(protect·held) 신호 + 1h 모멘텀(급락/급등·무포지션 무관) movement 신호 둘 다 인입.
  const signals = result.snapshots
    .flatMap((snap) => [priceObservationToSignal(snap), priceMomentumToSignal(snap)])
    .filter((s): s is Signal => s !== null);
  let ingested = 0;
  for (const s of signals) if (pool.ingest(s).inserted) ingested += 1;
  return { signals: signals.length, ingested };
}

if (import.meta.main) {
  const db = openRegimeDb();
  const recent = recentRegimeVectors(db, 2);
  const deps: PriceGuardCycleDeps = {
    quote: (s) => omniQuote(s),
    latestRegime: () => latestRegimeVector(db),
    previousRegime: () => recent[1] ?? null,
    now: () => new Date().toISOString(),
  };
  const result = runPriceGuardCycle(deps);
  db.close();
  // ★ 1h 모멘텀 보강(대표 2026-07-15) — 시세 이력 적재 후 "1시간 대비" 급락/급등 계산해 스냅샷에
  //   부착. 무포지션 종목도 대상(움직임 알림은 보유 무관). 다이나믹 1h 기준(전일종가 아님).
  try {
    const { openPriceHistoryDb, recordPrice, computeMomentum, pruneOldPrices } = await import('../src/domains/price-history.js');
    const phDb = openPriceHistoryDb();
    const nowMs = Date.now();
    try {
      for (const snap of result.snapshots) {
        recordPrice(phDb, snap.symbol, snap.price, snap.timestamp);
        snap.momentum1h = computeMomentum(phDb, snap.symbol, Date.parse(snap.timestamp), snap.price);
      }
      pruneOldPrices(phDb, nowMs);
    } finally { phDb.close(); }
  } catch { /* fail-soft — 모멘텀 없으면 보호 신호만 */ }
  // ★ 실 SignalPool 인입 — 어댑터→ingest 배선(위 dead-code 수습). 기존 gate1/gate2/router 가 이어받음.
  const { SignalPool } = await import('../src/domains/signal-pool.js');
  const pool = new SignalPool();
  let wired = { signals: 0, ingested: 0 };
  try { wired = ingestPriceGuardSignals(result, pool); } finally { pool.close(); }
  console.log(JSON.stringify({
    snapshots: result.snapshots.length,
    decisions: result.decisions.length,
    signals: wired.signals,
    ingested: wired.ingested,
    errors: result.errors,
    quoteCallCount: result.quoteCallCount,
  }, null, 2));
}
