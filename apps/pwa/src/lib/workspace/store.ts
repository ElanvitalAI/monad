/**
 * Workspace reducer + actions.
 *
 * Pure reducer (no side effects · no localStorage). Persist layer wraps
 * this in apps/pwa/src/lib/workspace/persist.ts. Provider hook wraps
 * persist + reducer in apps/pwa/src/components/workspace/WorkspaceProvider.tsx
 * (PR #3).
 *
 * Invariants enforced:
 *   - state.order has the same set of ids as state.tabs (1:1)
 *   - activeId ∈ state.tabs (or null when tabs is empty)
 *   - single-instance kinds collapse — adding `term`/`voice`/`intake`/
 *     `control`/`settings` when one already exists activates the
 *     existing tab instead of creating a duplicate
 *   - frozenIds ⊆ tab ids
 */

import {
  isSingleInstanceKind,
  type WorkspaceState,
  type WorkspaceTab,
  type WorkspaceTabKind,
} from './types';

export const initialWorkspaceState: WorkspaceState = {
  tabs: [],
  activeId: null,
  order: [],
  frozenIds: [],
};

export type WorkspaceAction =
  | {
      type: 'addTab';
      tab: WorkspaceTab;
      /** activate-on-add (default true). false = add 후 활성 변화 없음. */
      activate?: boolean;
    }
  | { type: 'closeTab'; id: string }
  | { type: 'activateTab'; id: string }
  | { type: 'reorderTab'; id: string; toIndex: number }
  | {
      type: 'updateTab';
      id: string;
      patch: Partial<Omit<WorkspaceTab, 'id' | 'kind' | 'createdAt'>>;
    }
  | { type: 'freezeTab'; id: string }
  | { type: 'unfreezeTab'; id: string }
  | { type: 'replace'; state: WorkspaceState };

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'addTab': {
      const incoming = action.tab;
      const activate = action.activate ?? true;
      // single-instance collapse
      if (isSingleInstanceKind(incoming.kind)) {
        const existing = state.tabs.find((t) => t.kind === incoming.kind);
        if (existing) {
          return activate ? { ...state, activeId: existing.id } : state;
        }
      }
      // duplicate id guard — pure no-op rather than throwing.
      if (state.tabs.some((t) => t.id === incoming.id)) {
        return activate ? { ...state, activeId: incoming.id } : state;
      }
      const tabs = [...state.tabs, incoming];
      const order = [...state.order, incoming.id];
      return {
        ...state,
        tabs,
        order,
        activeId: activate ? incoming.id : state.activeId,
      };
    }

    case 'closeTab': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx < 0) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const order = state.order.filter((x) => x !== action.id);
      const frozenIds = state.frozenIds.filter((x) => x !== action.id);
      let activeId = state.activeId;
      if (state.activeId === action.id) {
        if (order.length === 0) {
          activeId = null;
        } else {
          // 가까운 인접 (이전이 있으면 이전 · 없으면 다음) 활성화
          const closedOrderIdx = state.order.indexOf(action.id);
          const nextIdx = Math.min(
            Math.max(closedOrderIdx - 1, 0),
            order.length - 1,
          );
          activeId = order[nextIdx];
        }
      }
      return { ...state, tabs, order, frozenIds, activeId };
    }

    case 'activateTab': {
      if (!state.tabs.some((t) => t.id === action.id)) return state;
      if (state.activeId === action.id) return state;
      // activate auto-unfreeze (PR #5 의 LRU freeze 와 결을 맞추기 위해)
      const frozenIds = state.frozenIds.filter((x) => x !== action.id);
      return { ...state, activeId: action.id, frozenIds };
    }

    case 'reorderTab': {
      if (!state.tabs.some((t) => t.id === action.id)) return state;
      const fromIdx = state.order.indexOf(action.id);
      if (fromIdx < 0) return state;
      const clamped = Math.max(0, Math.min(action.toIndex, state.order.length - 1));
      if (clamped === fromIdx) return state;
      const order = [...state.order];
      order.splice(fromIdx, 1);
      order.splice(clamped, 0, action.id);
      return { ...state, order };
    }

    case 'updateTab': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx < 0) return state;
      const cur = state.tabs[idx];
      // 안전 patch: kind/id/createdAt 은 변경 불가 (타입에서 제외했지만
      // runtime 에서도 강제). chat 만 sessionId/title 받음.
      const allowed: Record<string, unknown> = {};
      if (cur.kind === 'chat') {
        if ('sessionId' in action.patch && typeof action.patch.sessionId === 'string') {
          allowed.sessionId = action.patch.sessionId;
        }
        if ('title' in action.patch) {
          allowed.title = action.patch.title;
        }
      }
      if (Object.keys(allowed).length === 0) return state;
      const merged = { ...cur, ...allowed } as WorkspaceTab;
      const tabs = [...state.tabs];
      tabs[idx] = merged;
      return { ...state, tabs };
    }

    case 'freezeTab': {
      if (!state.tabs.some((t) => t.id === action.id)) return state;
      // active 탭은 freeze 금지
      if (state.activeId === action.id) return state;
      if (state.frozenIds.includes(action.id)) return state;
      return { ...state, frozenIds: [...state.frozenIds, action.id] };
    }

    case 'unfreezeTab': {
      if (!state.frozenIds.includes(action.id)) return state;
      return {
        ...state,
        frozenIds: state.frozenIds.filter((x) => x !== action.id),
      };
    }

    case 'replace': {
      return action.state;
    }
  }
}

/** 헬퍼 — 새 chat 탭 합성. id 는 호출자가 결정 (crypto.randomUUID 등). */
export function makeChatTab(args: {
  id: string;
  sessionId: string;
  title?: string;
  createdAt?: number;
}): WorkspaceTab {
  return {
    id: args.id,
    kind: 'chat',
    sessionId: args.sessionId,
    ...(args.title !== undefined ? { title: args.title } : {}),
    createdAt: args.createdAt ?? Date.now(),
  };
}

/** 헬퍼 — 단일 instance kind 의 새 탭 합성. */
export function makeSingleTab(args: {
  id: string;
  kind: Exclude<WorkspaceTabKind, 'chat'>;
  createdAt?: number;
}): WorkspaceTab {
  return {
    id: args.id,
    kind: args.kind,
    createdAt: args.createdAt ?? Date.now(),
  };
}

/** 헬퍼 — order 순서대로 tab 객체 list 를 반환. */
export function tabsInOrder(state: WorkspaceState): WorkspaceTab[] {
  const byId = new Map(state.tabs.map((t) => [t.id, t]));
  const out: WorkspaceTab[] = [];
  for (const id of state.order) {
    const t = byId.get(id);
    if (t) out.push(t);
  }
  return out;
}

/** 헬퍼 — kind 기준 첫 매치. single-instance 활성 이동 시 사용. */
export function findTabByKind(
  state: WorkspaceState,
  kind: WorkspaceTabKind,
): WorkspaceTab | undefined {
  return state.tabs.find((t) => t.kind === kind);
}
