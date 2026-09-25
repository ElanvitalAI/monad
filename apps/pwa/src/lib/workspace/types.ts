/**
 * PWA 워크스페이스 멀티탭 상태 타입.
 *
 * `chat` 탭만 multi-instance · 나머지는 single-instance (PLAN §2 결정 sheet).
 * `chat` 탭은 sessionId 를 명시적으로 들고 있어 cross-device session attach
 * 의 vehicle 이 된다 (cli/tg/dc → PWA 워크스페이스로 끌어오는 경로). 다른
 * kind 는 자체적으로 single-instance 라 추가 식별자가 필요 없다.
 */

// Phase 2 (PWA chat ↔ voice 일원화 · 2026-05-07) — 'voice' kind dropped.
// Voice has folded into the chat tab via the header mic toggle (Phase 1).
// Surface-unification v2.2 V2.2-6 (2026-05-11) — 'scheduler' kind dropped.
// Scheduling is now owned by workflow triggers (`scheduleTrigger` node),
// and recurring runs surface under `/workflows`. Persisted workspace
// state with legacy 'scheduler' or 'voice' tabs is dropped silently by
// `persist.isValidTab` (VALID_KINDS no longer contains either).
export type WorkspaceTabKind =
  | 'chat'
  | 'term'
  | 'intake'
  | 'tasks'
  | 'workflows'
  | 'control'
  | 'settings';

export type WorkspaceTab =
  | {
      id: string;
      kind: 'chat';
      sessionId: string;
      title?: string;
      createdAt: number;
    }
  | { id: string; kind: 'term'; createdAt: number }
  | {
      id: string;
      kind: 'intake' | 'tasks' | 'workflows' | 'control' | 'settings';
      createdAt: number;
    };

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeId: string | null;
  /** Tab id 의 display 순서. tabs 와 별도로 두어 reorder 가 tab 정의를
   *  건드리지 않게 한다. tabs 와 1:1 일치 유지 (reducer 가 보장). */
  order: string[];
  /** PR #5 LRU freeze 결과. 이번 PR 에서는 placeholder 로 빈 배열만 유지. */
  frozenIds: string[];
}

/** Single-instance kind 인지 검사 — chat 만 multi-instance. */
export function isSingleInstanceKind(kind: WorkspaceTabKind): boolean {
  return kind !== 'chat';
}
