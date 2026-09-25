// ── 분해기↔비평기 공진화 자동 되먹임 루프 (RFC §3C · P3) ───────────────────────────
//
// 제1원칙(자기 수렴): critique 치명(critical)이 남으면 사람에게 곧장 위임(HITL)하지 않고, 먼저
// **인루프로 K회 자동 재분해**해 스스로 수렴시킨다. GAN 공진화의 폐루프화 — 비평기(D)가 잡은 치명
// 지적을 분해기(G)가 reviseContext 로 받아 재생성 → 재비평 → 개선을 반복한다.
//
// 발산 3중 방어(RFC §7):
//   ① K회 상한        — maxRounds 초과 시 중단(잔여는 HITL).
//   ② 단조성 불변식    — **치명 내용(집합) 기반**. 같은 치명이 반복되거나(persisted) 이미 본 치명으로
//                        되돌아오면(진동) 중단. 치명이 **교체**(이전 해소+처음 보는 새 치명)되면 진전으로
//                        보고 1회 더. ★ 개수 기반이면 "해소 1 + 신규 1 = 정체"로 오판(dogfood 2026-07-18
//                        실측: under_specified 해소됐는데 새 ungrounded 발생을 1->1 정체로 조기 중단).
//   ③ 정당성 게이트    — critique 자체가 kind rubric(#4529)+사전정보(#4531)로 오탐을 이미 걸러냄
//                        (이 모듈 밖·recritique 주입이 소비). 오탐이 루프를 헛돌리지 않게 함.
//
// 안전: 집행 0·armed 아님(순수 분해 설계 정련). 재분해는 decomposeMissionToPhases 의 트랜잭셔널
//   교체(#6)에 의존 — 성공(tasks>=2) 후에만 옛 페이즈 clean reset, 실패 시 옛 페이즈 보존(고아 없음).
//   비파괴 폴백: 호출측 opt-in(autopilot.coevolveAuto) OFF 면 이 루프 미진입(현행 BC3 수동 유지).

import { debug } from '../debug/log.js';
import type { DecompCritiqueResult, PhaseCritique } from './mission-decomp-critique.js';
import { buildRedecomposeComment } from './mission-build-coordinator-driver.js';

/** critique 결과의 치명(critical) 개수 — 표시/게이트용 스칼라. 순수. */
export function countCritical(critique: DecompCritiqueResult | null | undefined): number {
  if (!critique) return 0;
  return critique.critiques.filter((c) => c.severity === 'critical').length;
}

/** 치명 1건의 안정 식별키 — verdict + reason 정규화. phaseId/title 은 재분해마다 바뀌므로 내용 기반
 *  (같은 결손이면 reason 앞부분이 유사해 같은 키로 수렴·진동/반복 탐지). 순수. */
function criticalKey(c: PhaseCritique): string {
  const norm = c.reason.toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 50);
  return `${c.verdict}:${norm}`;
}

/** critique 의 치명 식별키 집합 — 라운드 간 diff(해소/신규/잔존)의 단위. 순수. */
export function criticalKeys(critique: DecompCritiqueResult | null | undefined): Set<string> {
  const s = new Set<string>();
  if (!critique) return s;
  for (const c of critique.critiques) if (c.severity === 'critical') s.add(criticalKey(c));
  return s;
}

export type CoevolveAction =
  | 'converged'      // 치명 0 — 수렴 성공(채택·중단).
  | 'improved'       // 이전 치명 전부 해소 + 처음 보는 새 치명 — 진전(채택·계속).
  | 'stop-diverged'  // ★이번 라운드가 치명을 늘림(발산) — 즉시 중단(최선 라운드로 keep-best).
  | 'stop-exhausted' // 진전했으나 K회 소진 — 채택·중단(잔여 HITL).
  | 'stop-stalled';  // 같은 치명 반복(persisted) 또는 진동(novel 이 이미 seen) — 중단(잔여 HITL).

/** 라운드 diff 통계(관측·판정). */
export interface CoevolveDiff { resolved: number; novel: number; persisted: number }

/**
 * 재분해 후 상태로 다음 행동을 결정한다 — **치명 내용(집합) 기반**. 순수·결정론(단위테스트 대상).
 * @param prevKeys 재분해 **전** 치명 키 집합
 * @param nextKeys 재분해 **후** 치명 키 집합
 * @param seenKeys 지금까지(이전 라운드 포함) 본 모든 치명 키 — 진동(재출현) 판정용
 * @param round    방금 끝난 라운드 번호(1-base)
 * @param maxRounds K회 상한
 */
export function evalCoevolveRound(
  prevKeys: Set<string>, nextKeys: Set<string>, seenKeys: Set<string>,
  round: number, maxRounds: number,
): { action: CoevolveAction; continue: boolean } & CoevolveDiff {
  const persisted = [...nextKeys].filter((k) => prevKeys.has(k)).length;         // 같은 치명 반복(안 고쳐짐)
  const resolved = [...prevKeys].filter((k) => !nextKeys.has(k)).length;         // 이번에 해소된 치명
  const novelKeys = [...nextKeys].filter((k) => !prevKeys.has(k));               // 새로 생긴 치명
  const novelUnseen = novelKeys.filter((k) => !seenKeys.has(k)).length;          // 그중 처음 보는 것
  const diff: CoevolveDiff = { resolved, novel: novelKeys.length, persisted };
  if (nextKeys.size === 0) return { action: 'converged', continue: false, ...diff };
  // ★ 발산 가드(대표 2026-07-19·"발산 하면 안 된다") — 이번 재분해가 치명을 늘렸으면(악화) 즉시 중단.
  //   더 돌수록 나빠지므로(dogfood 실측 5→9) 한 번 더 안 돌고 멈춘다. keep-best 가 최선 라운드를 채택.
  if (nextKeys.size > prevKeys.size) return { action: 'stop-diverged', continue: false, ...diff };
  if (round >= maxRounds) return { action: 'stop-exhausted', continue: false, ...diff };
  // 진전 = 이전 치명을 전부 해소(persisted 0)하고 처음 보는 새 국면(novelUnseen>0)이면 1회 더.
  if (persisted === 0 && novelUnseen > 0) return { action: 'improved', continue: true, ...diff };
  // 그 외 = 같은 치명 반복(persisted>0) 또는 진동(novel 이 전부 seen) → 헛도는 루프. 중단.
  return { action: 'stop-stalled', continue: false, ...diff };
}

/** 라운드 이력 1건(관측·회상용). */
export interface CoevolveRoundRecord extends CoevolveDiff {
  round: number;
  prevCritical: number;
  nextCritical: number;
  action: CoevolveAction | 'redecompose-failed';
}

export interface CoevolveResult<P> {
  /** 실제로 돈 재분해 라운드 수(0 = 진입만·재분해 없음). */
  rounds: number;
  /** 최종 치명 0 여부(= 최선 라운드가 치명 0). */
  converged: boolean;
  /** ★ keep-best 채택 critique — 최선(치명 최소) 라운드(초기 포함). last 아님(발산 방어). */
  finalCritique: DecompCritiqueResult;
  /** ★ 마지막으로 DB 에 커밋된 라운드 critique(발산 시 DB reality — 실행될 실제 플랜의 비평). */
  lastCritique: DecompCritiqueResult;
  /** ★ 최선 라운드의 phases(초기가 최선이면 null = 초기 유지). */
  finalPhases: P[] | null;
  /** ★ 발산 감지 — 마지막 재분해 라운드가 최선보다 치명이 많음(DB 는 last·보고는 best). */
  diverged: boolean;
  /** 최선(치명 최소) 라운드 번호(0 = 초기 분해). */
  bestRound: number;
  /** 최선 라운드 치명 수. */
  bestCritical: number;
  /** 마지막으로 DB 에 커밋된 라운드 치명 수. */
  lastCritical: number;
  history: CoevolveRoundRecord[];
}

export interface CoevolveDeps<P> {
  missionId: string;
  /** 초기(1라운드 전) critique — 치명 있어야 호출측이 진입시킨다. */
  initialCritique: DecompCritiqueResult;
  /** K회 상한(호출측 config·기본 2). */
  maxRounds: number;
  /** critique 반영 재분해 → 새 phases(실패/0-task 시 null·이전 유지). */
  redecompose: (reviseContext: string, round: number) => Promise<P[] | null>;
  /** 새 phases 재비평. */
  recritique: (phases: P[], round: number) => Promise<DecompCritiqueResult>;
}

/**
 * 공진화 자동 되먹임 루프. critique 치명 → 재분해 → 재비평을 수렴/발산방어까지 반복한다.
 *
 * 흐름: 초기 치명 → while(치명>0 && round<K){ reviseContext=buildRedecomposeComment(현재 critique) →
 *   redecompose → (실패면 중단·이전 유지) → recritique → evalCoevolveRound(집합 diff) 로 채택/중단 }.
 * 관측: 매 라운드 `mission.coevolve.round` 로 resolved/novel/persisted·action 을 남긴다(제1원칙·회상).
 */
export async function runCoevolveLoop<P>(deps: CoevolveDeps<P>): Promise<CoevolveResult<P>> {
  const { missionId, initialCritique, maxRounds } = deps;
  let currentCritique = initialCritique; // 마지막 커밋 라운드 critique(= DB reality·lastCritique)
  let prevKeys = criticalKeys(initialCritique);
  const seen = new Set<string>(prevKeys); // 초기 치명도 seen(진동 판정 기준선)
  let round = 0;
  const history: CoevolveRoundRecord[] = [];

  // ★ keep-best(발산 방어·대표 2026-07-19) — 최선(치명 최소) 라운드를 추적해 채택한다. 종전엔
  //   마지막 라운드를 무조건 채택해 발산 시 더 나쁜 분해를 골랐다(dogfood 6→5→9→채택9).
  let bestCritique = initialCritique;
  let bestPhases: P[] | null = null;
  let bestCount = prevKeys.size; // 초기 치명(재분해 없으면 이게 최선)
  let bestRound = 0;

  debug.log('mission.coevolve.round', 'start', { missionId, initialCritical: prevKeys.size, maxRounds });

  while (prevKeys.size > 0 && round < maxRounds) {
    round++;
    const reviseContext = buildRedecomposeComment(currentCritique);
    const newPhases = await deps.redecompose(reviseContext, round);
    if (!newPhases || newPhases.length === 0) {
      // 재분해 실패(트랜잭셔널 보존·옛 페이즈 무손상) — 이전 상태 유지·중단.
      history.push({ round, prevCritical: prevKeys.size, nextCritical: prevKeys.size, action: 'redecompose-failed', resolved: 0, novel: 0, persisted: prevKeys.size });
      debug.log('mission.coevolve.round', 'redecompose-failed', { missionId, round, prevCritical: prevKeys.size }, { level: 'error' });
      break;
    }
    const newCritique = await deps.recritique(newPhases, round);
    const nextKeys = criticalKeys(newCritique);
    const evalR = evalCoevolveRound(prevKeys, nextKeys, seen, round, maxRounds);
    history.push({ round, prevCritical: prevKeys.size, nextCritical: nextKeys.size, action: evalR.action, resolved: evalR.resolved, novel: evalR.novel, persisted: evalR.persisted });
    // ★ 관측 강화(대표 2026-07-18) — 개수뿐 아니라 해소/신규/잔존 diff 를 남겨 정체 원인(반복 vs 교체)을 회상 가능하게.
    debug.log('mission.coevolve.round', evalR.action, {
      missionId, round, prevCritical: prevKeys.size, nextCritical: nextKeys.size,
      resolved: evalR.resolved, novel: evalR.novel, persisted: evalR.persisted, converged: nextKeys.size === 0,
    });
    for (const k of nextKeys) seen.add(k); // 다음 라운드 진동 판정용 누적
    // 재분해는 이미 DB 를 트랜잭셔널 교체함 — 마지막 상태(DB reality).
    currentCritique = newCritique;
    prevKeys = nextKeys;
    // ★ keep-best — 이번 라운드가 지금까지의 최선보다 치명이 적으면 최선으로 채택(보고·게이트 기준).
    if (nextKeys.size < bestCount) {
      bestCount = nextKeys.size; bestCritique = newCritique; bestPhases = newPhases; bestRound = round;
    }
    if (!evalR.continue) break;
  }

  const lastCritical = prevKeys.size;
  const converged = bestCount === 0;
  const diverged = lastCritical > bestCount; // 마지막 라운드가 최선보다 나쁨
  debug.log('mission.coevolve.round', 'done', {
    missionId, rounds: round, converged, bestCritical: bestCount, lastCritical, bestRound, diverged,
  });
  return {
    rounds: round, converged, finalCritique: bestCritique, lastCritique: currentCritique, finalPhases: bestPhases,
    diverged, bestRound, bestCritical: bestCount, lastCritical, history,
  };
}
