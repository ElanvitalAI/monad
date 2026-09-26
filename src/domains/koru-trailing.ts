// ── KORU 550주 스윙 운영안 로직 (익절 래더 + 트레일링 손절, 2026-07-06) ──
//
// 별도계좌 KORU 550주 스윙(KORU_swing_report §1·§4)을 elanous 로직화. 양면:
//
//  상방 — 익절 래더(§1, 시나리오C): 레벨별 매도 물량. 오를수록 계단 실현.
//    $655(25주)/$680(35)/$700(40)→450 유지 / $750(50)/$800(150)→250 코어.
//    3X는 강세에 계단 익절을 보상하고 홀드를 벌(감쇠)하므로 래더가 핵심.
//
//  하방 — 동적 트레일링 손절(§4): 최근 고가(highwater) 추적. 주가가 오르면
//    손절선도 따라 올린다(고정 $485 아님). 고가 −5%/−8%/−11.5% 3단, 단 전량선은
//    **본전($539.5) 아래로 절대 안 내림**. 검산: 고가 $610→$580/$561/$540 · $700→$665/$644/$620.
//
// state는 ~/.elanous/conatus/koru_trailing.json (highwater + 발동 래더). READ-ONLY
// 판단 — 실제 매도/청산은 verify+HITL. 이 모듈은 트리거 판정·손절선 계산만.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { conatusPath } from './conatus-data-dir.js';

const STATE_PATH = conatusPath('koru_trailing.json');
export const KORU_ENTRY_DEFAULT = 539.5; // 550주 평균단가 (본전 앵커)

// ── 익절 래더 (§1 시나리오C 확정, v91) ────────────────────────────────
export interface LadderRung { level: number; sellQty: number; remaining: number; note?: string; }

export const KORU_LADDER: LadderRung[] = [
  { level: 655, sellQty: 25, remaining: 525 },
  { level: 680, sellQty: 35, remaining: 490 },
  { level: 700, sellQty: 40, remaining: 450, note: '코어 유지선(목표 6.93억)' },
  { level: 750, sellQty: 50, remaining: 400 },
  { level: 800, sellQty: 150, remaining: 250, note: '상단 코어' },
];

export interface LadderTrigger { triggered: LadderRung[]; nextRung: LadderRung | null; }

/** 현재가 ≥ level인 미발동(firedLevels에 없는) rung을 익절 트리거로. */
export function computeLadderTriggers(current: number, firedLevels: number[], ladder = KORU_LADDER): LadderTrigger {
  const triggered = ladder.filter(r => current >= r.level && !firedLevels.includes(r.level));
  const nextRung = ladder.find(r => current < r.level) ?? null;
  return { triggered, nextRung };
}

// ── 동적 트레일링 손절 (§4) ───────────────────────────────────────────
const TRIM25_PCT = 0.05;  // 고가 −5%  → 25% 현금화
const TRIM50_PCT = 0.08;  // 고가 −8%  → 50% 현금화
const EXIT_PCT = 0.115;   // 고가 −11.5% → 전량 (본전 아래 금지)

export type TrailingAction = 'HOLD' | 'TRIM_25' | 'TRIM_50' | 'EXIT_ALL';

export interface TrailingStops {
  highwater: number;
  current: number;
  trim25: number;
  trim50: number;
  exitAll: number;
  entryFloorApplied: boolean;
  action: TrailingAction;
  note: string;
}

/** 순수 계산 — 고가/본전/현재가 → 손절선 3단 + 액션. */
export function computeTrailingStops(highwater: number, entryPrice: number, current: number): TrailingStops {
  const trim25 = highwater * (1 - TRIM25_PCT);
  const trim50 = highwater * (1 - TRIM50_PCT);
  const rawExit = highwater * (1 - EXIT_PCT);
  const exitAll = Math.max(rawExit, entryPrice); // ★ 본전 아래로는 절대 안 내림
  const entryFloorApplied = entryPrice > rawExit;

  let action: TrailingAction = 'HOLD';
  if (current <= exitAll) action = 'EXIT_ALL';
  else if (current <= trim50) action = 'TRIM_50';
  else if (current <= trim25) action = 'TRIM_25';

  const label: Record<TrailingAction, string> = {
    HOLD: '홀드 (손절선 위)',
    TRIM_25: `25% 현금화 — 고가 −5%($${trim25.toFixed(0)}) 이탈`,
    TRIM_50: `50% 현금화 — 고가 −8%($${trim50.toFixed(0)}) 이탈`,
    EXIT_ALL: `전량 현금화 — $${exitAll.toFixed(0)} 이탈${entryFloorApplied ? '(본전 클램프)' : ''}`,
  };
  return {
    highwater, current, trim25, trim50, exitAll, entryFloorApplied, action,
    note: `트레일링 §4: 고가 $${highwater.toFixed(0)} 기준 25%↓$${trim25.toFixed(0)} / 50%↓$${trim50.toFixed(0)} / 전량↓$${exitAll.toFixed(0)}(본전 $${entryPrice.toFixed(0)} 아래 금지). 현재 $${current.toFixed(0)} → ${label[action]}`,
  };
}

// ── state persistence ─────────────────────────────────────────────────
export interface SwingState {
  highwater: number;
  entryPrice: number;
  firedLadder: number[];    // 발동한 익절 레벨(중복 방지)
  lastNotifiedHigh: number; // 마지막으로 스톱 상향 알림한 고가(크론 스팸 방지)
  lastNotifiedPrice: number; // 마지막으로 알림한 현재가(하락 움직임 알림 스팸 방지)
  updatedAt: string;
}

export function loadSwingState(entryDefault = KORU_ENTRY_DEFAULT, path = STATE_PATH): SwingState {
  try {
    if (existsSync(path)) {
      const s = JSON.parse(readFileSync(path, 'utf-8')) as Partial<SwingState>;
      return {
        highwater: Number(s.highwater) || entryDefault,
        entryPrice: Number(s.entryPrice) || entryDefault,
        firedLadder: Array.isArray(s.firedLadder) ? s.firedLadder.map(Number) : [],
        lastNotifiedHigh: Number(s.lastNotifiedHigh) || 0,
        lastNotifiedPrice: Number(s.lastNotifiedPrice) || 0,
        updatedAt: String(s.updatedAt ?? ''),
      };
    }
  } catch { /* default */ }
  return { highwater: entryDefault, entryPrice: entryDefault, firedLadder: [], lastNotifiedHigh: 0, lastNotifiedPrice: 0, updatedAt: '' };
}

export function saveSwingState(state: SwingState, path = STATE_PATH): void {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

// ── Blue Ocean ATS 세션 상하한 (주간거래 리밋) ────────────────────────
// 미국 주간거래(Blue Ocean 오버나이트)는 기준가(7:30PM ET 마지막 체결가≈전일종가)
// 대비 **±20%** 밖 주문을 거부한다 → 상한가/하한가에서 가격이 고정(limit-up/down).
// 따라서 상한 위의 익절 래더는 그 세션엔 체결 불가(다음 세션 리밋 리셋까지 대기).
export const BLUE_OCEAN_LIMIT_PCT = 0.20;

export interface SessionLimit {
  refPrice: number;   // 기준가(전일종가 근사·7:30PM ET last sale)
  upper: number;      // 상한 = refPrice × 1.20 (그 위 익절 체결 불가)
  lower: number;      // 하한 = refPrice × 0.80
  atUpper: boolean;   // 현재가 상한 도달(상한가)
  atLower: boolean;   // 현재가 하한 도달(하한가)
}

/** Blue Ocean 세션 상하한 계산. refPrice=기준가(전일종가). current=현재가. */
export function blueOceanLimit(refPrice: number, current: number): SessionLimit {
  const upper = refPrice * (1 + BLUE_OCEAN_LIMIT_PCT);
  const lower = refPrice * (1 - BLUE_OCEAN_LIMIT_PCT);
  return {
    refPrice, upper, lower,
    atUpper: current >= upper * 0.999,
    atLower: current <= lower * 1.001,
  };
}

// ── 통합 평가 (상방 익절 래더 + 하방 트레일링 손절) ───────────────────
export interface KoruSwingEval {
  current: number;
  ladder: LadderTrigger;
  stops: TrailingStops;
  state: SwingState;
  /** 주간거래(Blue Ocean) 세션 상하한. refPrice 주입 시에만. */
  sessionLimit?: SessionLimit;
}

/** 현재가로 highwater 갱신(트레일링 상향) + 익절 래더 트리거 + 손절선 계산.
 *  now는 caller 주입(결정성). READ-ONLY 판단 — 실제 매도는 verify+HITL.
 *
 *  sessionHigh = 오늘 세션 실제 고가(EODHD real-time quote의 `high`). 크론이
 *  10분마다 현재가만 찍으면 그 사이 진짜 고점을 놓쳐 highwater 가 낮아지고
 *  트레일링 손절선 전체가 어긋난다(예: intraday $621 인데 스냅샷 $541 → 스톱
 *  $549 로 오판). 세션 고가를 먹여 이를 교정한다. 미주입 시 current 로 fallback
 *  (기존 동작). ★ 고점 판정엔 sessionHigh, 손절 액션엔 current(실시간) 사용. */
export function evaluateKoruSwing(current: number, now: string, path = STATE_PATH, sessionHigh?: number, refPrice?: number): KoruSwingEval {
  const prev = loadSwingState(KORU_ENTRY_DEFAULT, path);
  const effHigh = Math.max(current, sessionHigh ?? current); // 오늘 세션 도달 최고가
  const highwater = Math.max(prev.highwater, effHigh); // ★ 오르면 따라 올림(내리면 유지)

  // 익절 래더 도달 판정 = 세션 고가 기준(지정가 예약주문은 intraday 터치에 체결).
  const ladder = computeLadderTriggers(effHigh, prev.firedLadder);
  const firedLadder = [...prev.firedLadder, ...ladder.triggered.map(r => r.level)].sort((a, b) => a - b);

  // 손절 액션 = 현재가(실시간) 기준 — 고가가 아니라 지금 스톱 아래인지로 판정.
  const stops = computeTrailingStops(highwater, prev.entryPrice, current);
  const state: SwingState = {
    highwater, entryPrice: prev.entryPrice, firedLadder,
    lastNotifiedHigh: prev.lastNotifiedHigh, lastNotifiedPrice: prev.lastNotifiedPrice, updatedAt: now,
  };
  saveSwingState(state, path);
  // 주간거래 기준가 주입 시 세션 상하한(±20%) 계산.
  const sessionLimit = (refPrice && refPrice > 0) ? blueOceanLimit(refPrice, current) : undefined;
  return { current, ladder, stops, state, sessionLimit };
}

// ── 예약주문 세팅 가이드 + 스톱 조정 알림 (수동계좌·삼성증권) ──────────
/** 스윙 평가 → 삼성증권 예약주문 세팅 가이드. 익절 래더(미체결분 지정가 매도) +
 *  손절 스톱로스(트레일링) + 신규 이벤트(익절 도달·손절·스톱 상향). 실시간 체결은
 *  증권사 예약주문/스톱로스가, elanous는 세팅 가이드·조정 안내만(10분 체크로 충분). */
export function formatOrderPlan(e: KoruSwingEval): string {
  const st = e.state;
  const lines: string[] = ['📋 KORU 550주 삼성증권 세팅 안내', ''];

  // 신규 이벤트 (익절 도달·손절 액션)
  const events: string[] = [];
  for (const r of e.ladder.triggered)
    events.push(`🎯 $${r.level} 도달 → ${r.sellQty}주 매도 (잔여 ${r.remaining}${r.note ? ` · ${r.note}` : ''})`);
  if (e.stops.action === 'TRIM_25') events.push(`🟡 고가 −5%($${e.stops.trim25.toFixed(0)}) 이탈 → 25% 현금화`);
  else if (e.stops.action === 'TRIM_50') events.push(`🟠 고가 −8%($${e.stops.trim50.toFixed(0)}) 이탈 → 50% 현금화`);
  else if (e.stops.action === 'EXIT_ALL') events.push(`🔴 $${e.stops.exitAll.toFixed(0)} 이탈 → 전량 현금화${e.stops.entryFloorApplied ? '(본전 방어)' : ''}`);
  if (events.length) lines.push(...events, '');

  // 주간거래(Blue Ocean) 세션 상하한 — 상한 위 익절은 이번 세션 체결 불가.
  const lim = e.sessionLimit;
  if (lim) {
    lines.push(`[주간거래 리밋 — Blue Ocean ±20%]`);
    lines.push(`기준가 ~$${lim.refPrice.toFixed(0)}(전일종가 근사) → 상한 ~$${lim.upper.toFixed(0)} / 하한 ~$${lim.lower.toFixed(0)}${lim.atUpper ? ' · 🔒 상한가(그 위 체결 불가)' : lim.atLower ? ' · 🔒 하한가' : ''}`);
    lines.push(`  ※ Blue Ocean 실제 기준가=7:30PM ET 마지막 체결가 → 4PM 종가와 몇 $ 차이 가능(실제 상한이 표시보다 약간 높을 수 있음)`);
    lines.push('');
  }

  // 익절 예약주문 (미체결 래더) — 세션 상한 위 rung 은 이번 세션 대기 표시.
  lines.push('[익절 — 예약주문/지정가 매도]');
  const pending = KORU_LADDER.filter(r => !st.firedLadder.includes(r.level));
  lines.push(pending.length
    ? pending.map(r => {
        const blocked = lim && r.level > lim.upper;
        return `$${r.level}→${r.sellQty}주${r.remaining <= 450 ? `(코어${r.remaining})` : ''}${blocked ? '🔒리밋대기' : ''}`;
      }).join(' · ')
    : '(전량 익절 완료)');
  if (lim && pending.some(r => r.level > lim.upper))
    lines.push(`  ※ 🔒 = 주간거래 상한 $${lim.upper.toFixed(0)} 초과 → 다음 세션(리밋 리셋)/미국 정규장 대기`);
  lines.push('');

  // 하방 방어 레벨 (현재가 대비) — 주간 움직임에 따라 동적 갱신. 다음에 닿을
  // 방어선까지 거리 + 접근 경고. 고가 오르면 이 레벨들도 자동 상향(트레일링).
  lines.push('[하방 방어 — 현재가 대비]');
  lines.push(`전량 스톱 $${e.stops.exitAll.toFixed(0)} (본전 $${st.entryPrice.toFixed(0)} 방어) · 트레일링 고가 $${st.highwater.toFixed(0)}×−11.5%`);
  const nd = nextDefense(e);
  if (nd) {
    const gapPct = ((e.current / nd.level - 1) * 100);
    const near = gapPct <= DEFENSE_WARN_PCT * 100;
    lines.push(`${near ? '⚠️ 접근' : '다음 방어선'}: $${nd.level.toFixed(0)} (${nd.label}) — 현재 $${e.current.toFixed(0)}에서 ${gapPct >= 0 ? '−' : '이미 이탈 '}${Math.abs(gapPct).toFixed(1)}%${near ? ` → ${nd.action} 준비` : ''}`);
  } else {
    lines.push(`현재 $${e.current.toFixed(0)} 이 전량 스톱 아래 — 방어 실행 구간`);
  }
  lines.push('');
  lines.push(`(현재 $${e.current.toFixed(0)} · 다음 익절 ${e.ladder.nextRung ? `$${e.ladder.nextRung.level}` : '없음(상단)'} · READ-ONLY 안내·실 매도는 증권사)`);
  return lines.join('\n');
}

// ── 하방 방어선 근접(주간 움직임 알림) ────────────────────────────────
/** 현재가가 방어선의 이 비율 안(위)에 들면 "접근" 경고 + 하락 알림 발송. */
export const DEFENSE_WARN_PCT = 0.02; // 2% 이내 접근 시 경고
/** 하락 알림 임계: 마지막 알림가 대비 이만큼 하락하면 레벨 재고지. */
export const DOWN_MOVE_PCT = 0.02;

/** 현재가 바로 아래(가장 가까운) 방어선 = 다음에 닿을 트레일링 스톱. */
export function nextDefense(e: KoruSwingEval): { level: number; label: string; action: TrailingAction } | null {
  const s = e.stops;
  // 위→아래 순으로, 현재가보다 낮은 첫 방어선.
  const rungs: Array<{ level: number; label: string; action: TrailingAction }> = [
    { level: s.trim25, label: '고가−5%·25% 현금화', action: 'TRIM_25' },
    { level: s.trim50, label: '고가−8%·50% 현금화', action: 'TRIM_50' },
    { level: s.exitAll, label: '전량·본전 방어', action: 'EXIT_ALL' },
  ];
  for (const r of rungs) if (e.current > r.level) return r;
  return null; // 이미 전량 스톱 아래
}

/** 크론 알림 발송 여부:
 *  ① 신규 익절 도달 ② 손절 액션 ③ 고가 유의미 갱신(스톱 상향)
 *  ④ 하락 움직임(마지막 알림가 대비 −DOWN_MOVE_PCT) ⑤ 방어선 근접(DEFENSE_WARN_PCT).
 *  ④⑤ 가 주간 하락 움직임에 따른 레벨/방어 알림을 담당. */
export function shouldAlert(e: KoruSwingEval, minHighDelta = 5): boolean {
  if (e.ladder.triggered.length > 0) return true;
  if (e.stops.action !== 'HOLD') return true;
  if (e.state.highwater >= (e.state.lastNotifiedHigh || 0) + minHighDelta) return true;
  const lastPx = e.state.lastNotifiedPrice || 0;
  // ④ 마지막 알림가 대비 유의미 하락.
  if (lastPx > 0 && e.current <= lastPx * (1 - DOWN_MOVE_PCT)) return true;
  // ⑤ 다음 방어선 근접(2% 이내) — 아직 이탈 전 선제 경고.
  const nd = nextDefense(e);
  if (nd && e.current <= nd.level * (1 + DEFENSE_WARN_PCT)) return true;
  return false;
}

/** 알림 발송 후 lastNotifiedHigh + lastNotifiedPrice 갱신(스팸 방지). */
export function markNotified(now: string, path = STATE_PATH, current?: number): void {
  const s = loadSwingState(KORU_ENTRY_DEFAULT, path);
  saveSwingState({ ...s, lastNotifiedHigh: s.highwater, lastNotifiedPrice: current ?? s.lastNotifiedPrice, updatedAt: now }, path);
}
