/**
 * Tab cap 정책 — 데스크탑 8 / 모바일 5 (PLAN §2 결정 sheet).
 *
 * 이 PR(#1) 에서는 *식별* 만 한다 (LRU 후보 산출). 실제 freeze 발동 ·
 * snapshot/restore 는 PR #5 에서. 그래서 reducer 가 cap 을 강제하지 않고,
 * caller (WorkspaceProvider · PR #3) 가 add 직후 후보를 받아 freezeTab
 * action 을 dispatch 하는 흐름이 된다.
 *
 * LRU 기준 = lastActivated 시각 desc (활성 → 최근 → 오래된 → freeze 후보).
 * Tab 객체에는 lastActivated 가 없으므로 호출자가 추적해 별도로 전달한다.
 * activeId 는 항상 alive 보호.
 */

import type { WorkspaceState } from './types';

export interface CapPolicy {
  /** 최대 alive 탭 수. 초과 시 가장 오래 미활성된 탭이 freeze 후보. */
  maxAlive: number;
}

export const DESKTOP_CAP: CapPolicy = { maxAlive: 8 };
export const MOBILE_CAP: CapPolicy = { maxAlive: 5 };

/** Freeze 추천 산출 결과. 빈 배열 = freeze 필요 없음. */
export interface CapPolicyDecision {
  /** Freeze 권장 tab id list (LRU 순 · 가장 오래된 게 첫 항목). */
  freezeCandidates: string[];
}

/** 현재 alive 탭 (= frozen 아닌) 가 cap 을 초과하면 LRU 순 후보 산출. */
export function applyCapPolicy(
  state: WorkspaceState,
  cap: CapPolicy,
  /** Tab id → 마지막 활성화 epoch ms. 누락된 id 는 createdAt 사용. */
  lastActivatedAt: ReadonlyMap<string, number>,
): CapPolicyDecision {
  const frozen = new Set(state.frozenIds);
  const aliveIds = state.tabs
    .map((t) => t.id)
    .filter((id) => !frozen.has(id));
  if (aliveIds.length <= cap.maxAlive) {
    return { freezeCandidates: [] };
  }
  // LRU 정렬 — activeId 는 맨 끝 (절대 freeze 안 됨)
  const tabById = new Map(state.tabs.map((t) => [t.id, t]));
  const sortable = aliveIds.map((id) => {
    const t = tabById.get(id);
    const ts = lastActivatedAt.get(id) ?? t?.createdAt ?? 0;
    return { id, ts };
  });
  sortable.sort((a, b) => a.ts - b.ts); // asc — 가장 오래된 먼저
  const need = aliveIds.length - cap.maxAlive;
  const candidates: string[] = [];
  for (const { id } of sortable) {
    if (candidates.length >= need) break;
    if (id === state.activeId) continue; // active 보호
    candidates.push(id);
  }
  return { freezeCandidates: candidates };
}
