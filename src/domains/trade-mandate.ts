// ── 매매 mandate (약속된 범위) — 자율매매 스코프 (2026-07-07 · 대표 지시) ──
//
// 대표 방침 전환: 토스계좌 = 프로그램 매매. per-trade 승인이 아니라 "약속된
// 범위(mandate)" 안에서는 승인 없이 자율 집행. HITL 승인은 컨셉/범위가 바뀔 때만.
// (기본 선제방어 룰과 다른 긴급상황이면 시스템이 물어봄=재승인.)
//
// ★ 안전: mandate.armed·live 는 기본 OFF. 대표가 finance 전용 json에서 명시로
//   켜기 전까지 실주문 0(dry). 자율이라도 스코프 가드(종목·매뉴얼정지·재승인)를
//   매 거래 강제. verify 게이트(리스크/노출/체결)는 그대로 자동 유지.
//
// 저장: ~/.elanous/finance-trade-mandate.json (대표 편집·변경=컨셉변경=재승인 대상).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import type { TradeIntent } from './trade-hitl.js';
import { marketSessions, type MarketSessions } from './finance.js';

/** 매매 mandate 정본 경로 — state-dir 존중(lazy · Phase B). prod(ELANOUS_STATE_DIR 미설정)=
 *  `~/.elanous/finance-trade-mandate.json`(무변경) · 격리 test=자기 루트(무장 파일 부재 →
 *  DISARMED fail-closed). 종전 homedir 하드코딩은 test 가 prod 무장 mandate 를 공유하던
 *  위험(안전강화 — 매매 무장류는 test↔prod 절대 공유 금지). */
export function tradeMandatePath(): string {
  return join(elanousStateRoot(), 'finance-trade-mandate.json');
}

export interface TradeMandate {
  /** 자율매매 마스터 스위치(대표 명시). 기본 false → 자율 집행 안 함. */
  armed: boolean;
  /** 실주문. 기본 false → dry(실주문 없음). armed+live 둘 다여야 실매매. */
  live: boolean;
  /** 대표가 직접 매뉴얼 매매 선언 시 true → 자율 정지. */
  manualPause: boolean;
  /** 주력(FOCUS) 종목 — 우선 집중 대상(삼성전자·KODEX레버리지·KORU). 화이트리스트
   *  아님 · 나머지 종목도 제약 없음(대표 지시). restrictToFocus=true면 이 밖 거부. */
  focusSymbols: string[];
  /** true면 focusSymbols만 허용(화이트리스트). 기본 false = 전 종목 허용(포커스는 우선순위). */
  restrictToFocus: boolean;
  /** 기본 전략(컨셉). 캡스톤 선제방어형. */
  strategy: string;
  /** 때에 따라 선제방어 + LV(레버리지형) 허용. */
  allowLV: boolean;
  /** 주문당 상한(KRW). null = 상한 없음(대표 지시). */
  maxOrderKrw: number | null;
  /** 총 노출·일일 한도 = 'strategy'(전략 자율) | 'hard'(하드캡·향후). */
  exposureMode: string;
  /** 매매 세션 창. 'all' = 모든 장. */
  sessions: string;
  /** 대표 추가 룰(capstone_override) 우선 적용. */
  overrideRulesPriority: boolean;
  /** 기본 선제방어 룰과 다른 긴급상황이면 재승인(대표에게 물어봄). */
  reapprovalOnUrgentDeviation: boolean;
  /** 총 운용 자본(KRW) — 2슬롯 배분 기준. */
  totalCapitalKrw: number;
  /** ★ C4 집행 모드(2026-07-10 · PLAN-trade-coordinator-mission). 'per-cycle'(기본·현행)
   *  = 각 사이클이 개별 집행 · 오케스트레이터는 dry 관측. 'orchestrator' = 규칙 사이클은
   *  제출-only(집행 skip) · 포트폴리오 오케스트레이터가 blackboard 통합 목표로 집행(이중집행
   *  방지·전체 밸런싱). 전환은 대표 HITL(json 편집). 기본 per-cycle 이라 회귀 0. */
  executionMode: 'per-cycle' | 'orchestrator';
  /** ★ D3 소스별 페이퍼(2026-07-10) — 이 소스 id 는 blackboard 제출·관측만 하고 오케스트레이터
   *  실집행에서 제외(dry). 예: 신규 미검증 계약을 일주일 페이퍼 관측 후 승격. 부재=[]. */
  paperSources: string[];
  /** ★ D3 자유 스윙 자본(원) — 자유스윙 사이클 weight 환산 기준. 부재 시 스크립트 기본. */
  freeSwing?: { capitalKrw: number };
  /** 2개 독립 슬롯(대표 지시 2026-07-07): A=삼성 캡스톤 · B=한국장 레버리지. */
  slots: {
    /** 슬롯 A — 삼성 캡스톤 선제방어형. 본주+삼성레버리지+삼성인버스. */
    samsungCapstone: {
      ratio: number;          // 2:1의 2
      strategy: string;       // 'capstone-preemptive-defense'
      symbols: { stock: string; lev2x: string; inverse2x: string };
    };
    /** 슬롯 B — 한국장 전체 레버리지 스윙(과도폭락 조건부·플레이북). */
    koreaLeverage: {
      ratio: number;          // 2:1의 1
      strategy: string;       // 'leverage-crash-swing'
      symbols: string[];      // ['122630', 'KORU.US']
    };
  };
  /** B4 · 자금풀 레이어(optional·대표 결정 2026-07-08). 부재 시 slots에서 파생(하위호환).
   *  main=삼성캡스톤(보수·불변) · aggressive=기존 slot B 완전 교체(백테스팅 승격분).
   *  실집행은 각 fund.armed+live 게이트로만. 기본 aggressive disarmed. */
  funds?: TradeFunds;
}

/** 자금풀 1개 — 독립 arming·자본·상한. */
export interface FundAllocation {
  capitalKrw: number;
  strategy: string;
  maxOrderKrw: number | null;
  armed: boolean;
  live: boolean;
  /** 페이퍼 트레이딩 단계(실집행 0). */
  paperMode?: boolean;
  /** 페이퍼→실자금 관찰 거래일(대표 결정=20). */
  observeDays?: number;
  /** 승격된 실험 id. */
  promotedExperiments?: string[];
  /** aggressive 가 대체한 기존 슬롯(감사). */
  replaces?: string;
}

export interface TradeFunds {
  main: FundAllocation;        // 보수(삼성캡스톤)·현행 불변
  aggressive: FundAllocation;  // 백테스팅 승격분(기존 slot B 교체)
}

/** 대표 미설정 시 기본 — armed/live OFF(안전). 대표가 json으로 덮어씀. */
export const DEFAULT_MANDATE: TradeMandate = {
  armed: false, live: false, manualPause: false,
  focusSymbols: [], restrictToFocus: false,
  strategy: 'capstone-preemptive-defense', allowLV: true,
  maxOrderKrw: null, exposureMode: 'strategy', sessions: 'all',
  overrideRulesPriority: true, reapprovalOnUrgentDeviation: true,
  totalCapitalKrw: 0,
  executionMode: 'per-cycle',
  paperSources: [],
  slots: {
    samsungCapstone: { ratio: 2, strategy: 'capstone-preemptive-defense', symbols: { stock: '005930', lev2x: '0193W0', inverse2x: '0193L0' } },
    koreaLeverage: { ratio: 1, strategy: 'leverage-crash-swing', symbols: ['122630', 'KORU.US'] },
  },
};

/** finance 전용 json 로드. 부재/손상 → 기본(disarmed·안전). */
export function loadMandate(path: string = tradeMandatePath()): TradeMandate {
  if (!existsSync(path)) return { ...DEFAULT_MANDATE };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<TradeMandate>;
    return {
      ...DEFAULT_MANDATE, ...raw,
      // 타입 안전 — 불리언/배열/숫자 강제.
      armed: raw.armed === true, live: raw.live === true, manualPause: raw.manualPause === true,
      restrictToFocus: raw.restrictToFocus === true,
      focusSymbols: Array.isArray(raw.focusSymbols) ? raw.focusSymbols.filter((s): s is string => typeof s === 'string') : [],
      totalCapitalKrw: Number(raw.totalCapitalKrw) > 0 ? Number(raw.totalCapitalKrw) : DEFAULT_MANDATE.totalCapitalKrw,
      // strict — 'orchestrator' 명시일 때만 오케스트레이터 집행. 그 외(부재/오타) = per-cycle(현행·안전).
      executionMode: raw.executionMode === 'orchestrator' ? 'orchestrator' : 'per-cycle',
      paperSources: Array.isArray(raw.paperSources) ? raw.paperSources.filter((s): s is string => typeof s === 'string') : [],
      freeSwing: (raw.freeSwing && typeof raw.freeSwing === 'object' && Number(raw.freeSwing.capitalKrw) > 0)
        ? { capitalKrw: Number(raw.freeSwing.capitalKrw) } : undefined,
      slots: (raw.slots && typeof raw.slots === 'object') ? { ...DEFAULT_MANDATE.slots, ...raw.slots } : DEFAULT_MANDATE.slots,
      // funds optional — 있으면 파싱(각 fund armed/live 강제 불리언), 없으면 undefined(slots 파생).
      funds: parseFunds(raw.funds),
    };
  } catch { return { ...DEFAULT_MANDATE }; } // 손상 = fail-closed(disarmed)
}

/** funds 파싱 — 각 fund armed/live 를 strict 불리언 강제(안전). 부재/손상 시 undefined. */
function parseFunds(raw: unknown): TradeFunds | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, any>;
  if (!r.main || !r.aggressive) return undefined;
  const fund = (f: any, disarmedDefault: boolean): FundAllocation => ({
    capitalKrw: Number(f?.capitalKrw) || 0,
    strategy: typeof f?.strategy === 'string' ? f.strategy : 'unknown',
    maxOrderKrw: f?.maxOrderKrw == null ? null : Number(f.maxOrderKrw),
    armed: f?.armed === true,      // strict — 미설정=disarmed
    live: f?.live === true,
    paperMode: f?.paperMode !== false && disarmedDefault ? true : f?.paperMode === true,
    observeDays: Number(f?.observeDays) > 0 ? Number(f.observeDays) : 20,
    promotedExperiments: Array.isArray(f?.promotedExperiments) ? f.promotedExperiments.filter((x: unknown): x is string => typeof x === 'string') : [],
    replaces: typeof f?.replaces === 'string' ? f.replaces : undefined,
  });
  return { main: fund(r.main, false), aggressive: fund(r.aggressive, true) };
}

/** 자금풀 해석 — funds 있으면 그대로, 없으면 slots에서 파생(하위호환).
 *  main=삼성캡스톤(현 armed/live 승계) · aggressive=기존 slot B 자리(disarmed·페이퍼). */
export function resolveFunds(mandate: TradeMandate): TradeFunds {
  if (mandate.funds) return mandate.funds;
  const total = mandate.totalCapitalKrw;
  const a = mandate.slots.samsungCapstone, b = mandate.slots.koreaLeverage;
  const denom = (a.ratio + b.ratio) || 1;
  return {
    main: {
      capitalKrw: Math.round(total * a.ratio / denom),
      strategy: a.strategy, maxOrderKrw: mandate.maxOrderKrw,
      armed: mandate.armed, live: mandate.live,  // 현 mandate 상태 승계(실돈 불변)
    },
    aggressive: {
      capitalKrw: Math.round(total * b.ratio / denom),
      strategy: 'backtest-promoted', maxOrderKrw: 5_000_000,
      armed: false, live: false, paperMode: true, observeDays: 20,  // 기본 disarmed·페이퍼
      replaces: 'koreaLeverage',
    },
  };
}

/** 심볼이 focus 목록 안인가 — 6자리 코드/기호 정규화 비교(우선순위·restrict 판정용). */
export function inFocus(symbol: string, list: string[]): boolean {
  const norm = (s: string) => s.replace(/\.(KO|KS|KQ|US)$/i, '').toUpperCase().trim();
  const n = norm(symbol);
  return list.some(s => norm(s) === n);
}

/** ★ 마켓 클럭 — 심볼이 지금 거래 가능한 세션인가 (2026-07-07 대표 지적).
 *  자율 경로는 trade-hitl verifyGate(MARKET_CLOSED)를 우회하므로 여기서 세션을 막는다.
 *  KR: krTradeable(NXT프리/정규/종가/애프터 = 거래 · 장전동시호가/CLOSED/휴장 제외).
 *  US(.US): usLive(프리/정규/애프터) 또는 usOvernight(주간거래 Blue Ocean). */
export function isSymbolTradeable(symbol: string, s: MarketSessions): boolean {
  const isUs = /\.US$/i.test(symbol);
  return isUs ? (s.usLive || s.usOvernight) : s.krTradeable;
}

export interface MandateVerdict {
  /** 자율 집행 허용 여부. */
  allowed: boolean;
  /** 허용 시 실주문(live) 여부 — mandate.live 반영. false면 dry. */
  live: boolean;
  reason: string;
  /** 긴급상황 등 — 자율 대신 대표 재승인 필요. */
  needsReapproval?: boolean;
}

/** 거래 1건이 mandate 안에서 자율 집행 가능한지 판정. 자율의 핵심 게이트.
 *  opts.urgentDeviation = 기본 선제방어 룰과 다른 긴급상황(전략이 판정).
 *  opts.sessions = 마켓 클럭(미주입 시 marketSessions() 실시간 판정). */
export function evaluateMandate(
  intent: TradeIntent, mandate: TradeMandate,
  opts: { urgentDeviation?: boolean; sessions?: MarketSessions } = {},
): MandateVerdict {
  if (!mandate.armed) return { allowed: false, live: false, reason: '자율매매 disarmed(대표 arming 필요·기본 off)' };
  if (mandate.manualPause) return { allowed: false, live: false, reason: '매뉴얼 정지(대표 직접 매매 중)' };
  // ★ 마켓 클럭 게이트 — 거래 가능 세션이 아니면 거부(장마감·휴장·장전동시호가).
  //   자율 경로는 trade-hitl verifyGate(MARKET_CLOSED)를 우회하므로 여기서 막는다.
  const sessions = opts.sessions ?? marketSessions();
  if (!isSymbolTradeable(intent.symbol, sessions)) {
    return { allowed: false, live: false, reason: `장 시간 아님(마켓클럭): ${intent.symbol} · KR ${sessions.kr} / US ${sessions.us}` };
  }
  // 종목: focus는 우선순위일 뿐 · 나머지도 제약 없음(대표 지시). restrictToFocus일 때만 거부.
  if (mandate.restrictToFocus && !inFocus(intent.symbol, mandate.focusSymbols)) {
    return { allowed: false, live: false, reason: `focus 밖 종목(restrictToFocus): ${intent.symbol} (focus ${mandate.focusSymbols.join('·') || '없음'})` };
  }
  if (opts.urgentDeviation && mandate.reapprovalOnUrgentDeviation) {
    return { allowed: false, live: false, reason: '긴급상황(기본 선제방어 룰 이탈) — 대표 재승인 필요', needsReapproval: true };
  }
  // 주문당 상한(null=없음)은 executor의 estimateValueKrw 단계에서 별도 체크.
  return { allowed: true, live: mandate.live, reason: `mandate 내 자율 집행 허용(${mandate.strategy})` };
}
