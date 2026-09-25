/**
 * localStorage 영속성 — schema version 가드 + 깨진 storage fallback.
 *
 * key: `monad.pwa.workspace`
 *
 * Wrapper 트리 (PR #3 의 WorkspaceProvider) 는 `loadWorkspaceState` 로
 * mount 시 hydrate · `saveWorkspaceState` 를 reducer wrap 으로 매번 호출.
 * 깨진 JSON / schema version 불일치 / 미지원 kind 가 있으면 조용히
 * 초기 state 로 복귀 (사용자에게 데이터 손실 알릴 필요 없음 — 워크스페이스
 * 탭은 ephemeral 도구).
 */

import { initialWorkspaceState } from './store';
import type {
  WorkspaceState,
  WorkspaceTab,
  WorkspaceTabKind,
} from './types';

export const WORKSPACE_STORAGE_KEY = 'monad.pwa.workspace';
export const WORKSPACE_SCHEMA_VERSION = 1;

interface PersistedShape {
  version: number;
  state: WorkspaceState;
}

// Phase 2 (PWA chat ↔ voice 일원화 · 2026-05-07) — 'voice' dropped.
// Surface-unification v2.2 V2.2-6 (2026-05-11) — 'scheduler' dropped
// (recurring jobs surface under workflows now).
// Persisted state with legacy 'voice' or 'scheduler' tabs gets silently
// filtered by isValidTab → state hydration drops them with a normalized
// active tab.
const VALID_KINDS = new Set<WorkspaceTabKind>([
  'chat',
  'term',
  'intake',
  'tasks',
  'workflows',
  'control',
  'settings',
]);

function isValidTab(t: unknown): t is WorkspaceTab {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (typeof o.kind !== 'string' || !VALID_KINDS.has(o.kind as WorkspaceTabKind)) {
    return false;
  }
  if (typeof o.createdAt !== 'number') return false;
  if (o.kind === 'chat') {
    if (typeof o.sessionId !== 'string' || o.sessionId.length === 0) return false;
    if (o.title !== undefined && typeof o.title !== 'string') return false;
  }
  return true;
}

function isValidState(s: unknown): s is WorkspaceState {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  if (!Array.isArray(o.tabs) || !o.tabs.every(isValidTab)) return false;
  if (!Array.isArray(o.order) || !o.order.every((x) => typeof x === 'string')) {
    return false;
  }
  if (!Array.isArray(o.frozenIds) || !o.frozenIds.every((x) => typeof x === 'string')) {
    return false;
  }
  if (o.activeId !== null && typeof o.activeId !== 'string') return false;
  return true;
}

/** order/activeId/frozenIds 가 tabs 와 정합인지 정리. 깨진 항목 drop. */
function normalize(state: WorkspaceState): WorkspaceState {
  const validIds = new Set(state.tabs.map((t) => t.id));
  const order = state.order.filter((x) => validIds.has(x));
  // 누락된 id 는 끝에 append (defensive)
  for (const t of state.tabs) {
    if (!order.includes(t.id)) order.push(t.id);
  }
  const frozenIds = state.frozenIds.filter((x) => validIds.has(x));
  let activeId = state.activeId;
  if (activeId !== null && !validIds.has(activeId)) {
    activeId = order[0] ?? null;
  }
  if (activeId === null && order.length > 0) {
    activeId = order[0];
  }
  return { tabs: state.tabs, order, frozenIds, activeId };
}

/** Storage 에서 hydrate. SSR 안전 (window 미정의 시 초기 state). */
export function loadWorkspaceState(): WorkspaceState {
  if (typeof window === 'undefined') return initialWorkspaceState;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return initialWorkspaceState;
  }
  if (!raw) return initialWorkspaceState;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return initialWorkspaceState;
  }
  if (!parsed || typeof parsed !== 'object') return initialWorkspaceState;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== WORKSPACE_SCHEMA_VERSION) {
    // future: migrate(version → current). v1 이 첫 schema 라 곧장 fallback.
    return initialWorkspaceState;
  }
  if (!isValidState(obj.state)) return initialWorkspaceState;
  return normalize(obj.state);
}

/** Storage 에 persist. 실패 시 조용히 swallow (storage 꽉 참 / private 모드). */
export function saveWorkspaceState(state: WorkspaceState): void {
  if (typeof window === 'undefined') return;
  const payload: PersistedShape = {
    version: WORKSPACE_SCHEMA_VERSION,
    state,
  };
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* swallow — 영속성 실패는 워크스페이스를 막지 않는다 */
  }
}

/** 테스트 / 사용자 reset 용. */
export function clearWorkspaceState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    /* swallow */
  }
}
