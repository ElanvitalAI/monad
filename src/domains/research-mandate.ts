// ── Research/Resolution Mandate — 적응형 투자 오토파일럿 A4 (2026-07-11) ────────
//
// 대표 §12.3 — 위험 계급별 두 자율 계약 중 **부작용 없는(읽기+문서/지식) 계약**. 해상도 심화
// (리서치·분석·신호추가)는 실돈/비가역이 아니므로 **대부분 자동 수용**한다. trade mandate 가
// fail-closed(disarmed 기본)인 것과 대칭적으로, research mandate 는 permissive(enabled 기본)이되
// **범위(섹터/종목·예산·주기·소스·산출물)** 안에서만. **매매·코드변경은 구조적 경계**(항상 거부·HITL).
//
// 이 모듈이 discovery 자동수용(§12.5·A4c)의 판정 로더 — discovery 미션이 이 범위 안이면 HITL 스킵.
//
// 안전: 부작용 sideEffect!=='none'(trade/code)은 mandate 무관하게 항상 거부(자동수용 아님).
//   손상/부재 = 안전 기본(enabled·범위 무제한이지만 부작용 경계는 불변).
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §12.3·§12.5·§12.6(A4).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { monadStateRoot } from '../autopilot/state-paths.js';

/** research mandate 정본 경로 — state-dir 존중(lazy · Phase B). prod=`~/.monad/
 *  finance-research-mandate.json`(무변경) · 격리 test=자기 루트. 부작용 없는 계약이나
 *  격리 test 가 prod mandate 를 상속하지 않도록 축 정합(trade mandate 와 대칭). */
export function researchMandatePath(): string {
  return join(monadStateRoot(), 'finance-research-mandate.json');
}

export interface ResearchMandate {
  /** 리서치 자율 활성(기본 true·부작용 없음). false 면 리서치도 전부 HITL. */
  enabled: boolean;
  /** 허용 섹터(빈 배열=제한 없음). */
  allowedSectors: string[];
  /** 허용 종목(빈 배열=제한 없음). */
  allowedSymbols: string[];
  /** 일일 조사 예산(작업 수·0=무제한). */
  dailyBudget: number;
  /** 최소 주기(분·과호출 방지·0=제한 없음). */
  minIntervalMin: number;
  /** 허용 소스(omni-crawl·omni-market 등·빈=제한 없음). */
  allowedSources: string[];
  /** 허용 산출물(analysis-doc·knowledge·signal·빈=제한 없음). */
  allowedOutputs: string[];
}

/** 기본 — 부작용 없는 계약이라 permissive(enabled·범위 무제한). 대표가 json 으로 좁힘.
 *  단 부작용 경계(trade/code 거부)는 이 값과 무관하게 항상 강제. */
export const DEFAULT_RESEARCH_MANDATE: ResearchMandate = {
  enabled: true,
  allowedSectors: [], allowedSymbols: [],
  dailyBudget: 0, minIntervalMin: 0,
  allowedSources: [], allowedOutputs: [],
};

/** finance 전용 json 로드. 부재/손상 → 기본(enabled·범위 무제한·부작용 경계 불변). */
export function loadResearchMandate(path: string = researchMandatePath()): ResearchMandate {
  try {
    if (!existsSync(path)) return { ...DEFAULT_RESEARCH_MANDATE };
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const strArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const num = (v: unknown, d: number): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d;
    return {
      enabled: raw.enabled !== false,   // 명시 false 만 off(부작용 없음·기본 on)
      allowedSectors: strArr(raw.allowedSectors),
      allowedSymbols: strArr(raw.allowedSymbols),
      dailyBudget: num(raw.dailyBudget, 0),
      minIntervalMin: num(raw.minIntervalMin, 0),
      allowedSources: strArr(raw.allowedSources),
      allowedOutputs: strArr(raw.allowedOutputs),
    };
  } catch { return { ...DEFAULT_RESEARCH_MANDATE }; } // 손상 = 안전 기본
}

/** 리서치 요청의 부작용 종류. none(읽기+문서/지식)만 자동수용 대상. trade/code 는 경계(항상 HITL). */
export type ResearchSideEffect = 'none' | 'trade' | 'code';

export interface ResearchRequest {
  sector?: string;
  symbol?: string;
  source?: string;
  output?: string;
  /** 부작용 — 'none'(읽기/문서/지식)만 자동수용. trade/code 는 구조적 경계. */
  sideEffect: ResearchSideEffect;
}

export interface ResearchVerdict {
  /** 자동 수용(HITL 스킵) 여부. */
  autoAccept: boolean;
  /** 구조적 경계(매매·코드변경)에 걸렸나 — true 면 mandate 무관 거부. */
  boundary: boolean;
  reason: string;
}

/** 일일 사용량·최근 실행(예산/주기 게이트·주입·순수 유지). */
export interface ResearchUsage { usedToday?: number; lastRunMs?: number; nowMs?: number; }

/** 리서치 요청이 research mandate 범위 안이라 자동 수용 가능한지 판정. 부작용은 항상 경계. */
export function evaluateResearchMandate(
  req: ResearchRequest, mandate: ResearchMandate, usage: ResearchUsage = {},
): ResearchVerdict {
  const reject = (reason: string, boundary = false): ResearchVerdict => ({ autoAccept: false, boundary, reason });

  // 0) 구조적 경계 — 매매·코드변경은 mandate 와 무관하게 항상 거부(자동수용 아님·HITL).
  if (req.sideEffect !== 'none') return reject(`부작용 경계(${req.sideEffect}) — 매매·코드변경은 항상 HITL`, true);

  // 1) 활성 — enabled=false 면 리서치도 HITL.
  if (!mandate.enabled) return reject('research mandate disabled(대표 명시 off) — HITL');

  // 2) 범위 — 지정된 화이트리스트가 있으면 그 안이어야(빈 배열=제한 없음).
  const inScope = (val: string | undefined, allow: string[], label: string): string | null => {
    if (allow.length === 0) return null;                      // 제한 없음
    if (val && allow.includes(val)) return null;
    return `범위 밖 ${label}(${val ?? '없음'} · 허용 ${allow.join('·')})`;
  };
  for (const [v, a, l] of [
    [req.sector, mandate.allowedSectors, '섹터'],
    [req.symbol, mandate.allowedSymbols, '종목'],
    [req.source, mandate.allowedSources, '소스'],
    [req.output, mandate.allowedOutputs, '산출물'],
  ] as const) {
    const err = inScope(v, a, l);
    if (err) return reject(`${err} — HITL`);
  }

  // 3) 예산 — 일일 상한 초과(0=무제한).
  if (mandate.dailyBudget > 0 && (usage.usedToday ?? 0) >= mandate.dailyBudget) {
    return reject(`일일 예산 소진(${usage.usedToday}/${mandate.dailyBudget}) — HITL`);
  }
  // 4) 주기 — 최소 간격 미만(과호출 방지·0=제한 없음).
  if (mandate.minIntervalMin > 0 && usage.lastRunMs != null && usage.nowMs != null) {
    const gapMin = (usage.nowMs - usage.lastRunMs) / 60_000;
    if (gapMin < mandate.minIntervalMin) return reject(`최소 주기 미만(${gapMin.toFixed(1)}m < ${mandate.minIntervalMin}m) — HITL`);
  }

  return { autoAccept: true, boundary: false, reason: `research mandate 범위 내 자동 수용(부작용 없음)` };
}
