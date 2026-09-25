'use client';

// PR #3 — Workspace Context + reducer wire + persist hook.
//
// 모든 워크스페이스 자식 (Strip · Canvas · AddTabPopover · TabPanel)
// 가 useWorkspace 로 같은 state 를 본다. mount 시 localStorage hydrate ·
// 매 reduce 후 persist. lastActivatedAt 은 PR #5 LRU freeze 가 쓰는
// 보조 인덱스로, Provider 가 in-memory 로만 유지 (장기 보존 가치 없음).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  initialWorkspaceState,
  workspaceReducer,
  makeChatTab,
  makeSingleTab,
} from '@/lib/workspace/store';
import {
  loadWorkspaceState,
  saveWorkspaceState,
} from '@/lib/workspace/persist';
import type {
  WorkspaceState,
  WorkspaceTab,
  WorkspaceTabKind,
} from '@/lib/workspace/types';
import { isSingleInstanceKind } from '@/lib/workspace/types';
import { generateSessionId } from '@/lib/daemon-session';
import {
  applyCapPolicy,
  DESKTOP_CAP,
  MOBILE_CAP,
} from '@/lib/workspace/cap-policy';

/** Picker 사용 모드 — `addNewChat` (새 chat 탭 add 시 사용) ·
 *  `attachToTab` (기존 chat 탭의 sessionId 교체). */
export type PickerMode =
  | { kind: 'addNewChat' }
  | { kind: 'attachToTab'; tabId: string };

interface WorkspaceContextValue {
  state: WorkspaceState;
  /** 새 탭 추가. chat 의 경우 sessionId 명시 또는 새로 생성. 자동
   *  활성화 (activate=false 옵션 미지원 — 워크스페이스 UX 단순화). */
  addTab: (
    tab:
      | { kind: 'chat'; sessionId?: string; title?: string }
      | { kind: Exclude<WorkspaceTabKind, 'chat'> },
  ) => string;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  reorderTab: (id: string, toIndex: number) => void;
  /** chat 탭 sessionId / title 변경. 다른 kind 는 무시. */
  updateChatTab: (id: string, patch: { sessionId?: string; title?: string }) => void;
  /** Single-instance kind 가 있으면 활성, 없으면 add. chat 은 항상 새 add
   *  (multi-instance 라 activateOrAdd 가 의미 없음 — 호출자가 이미
   *  picker UX 로 처리해야 함). */
  activateOrAdd: (kind: WorkspaceTabKind) => string | null;
  /** PR #4.5 — SessionPicker open state. Provider 가 보유하고
   *  /workspace/page.tsx 가 SessionPicker 를 mount. addNewChat ·
   *  attachToTab 두 모드. */
  pickerMode: PickerMode | null;
  openPicker: (mode: PickerMode) => void;
  closePicker: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function generateTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    initialWorkspaceState,
    (init) => init,
  );
  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null);

  // Hydrate from localStorage on first client render. SSR (state =
  // initial) → first effect → replace. 순간 깜빡임 보다 SSR 안전이
  // 우선.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const persisted = loadWorkspaceState();
    if (persisted.tabs.length > 0 || persisted.activeId !== null) {
      dispatch({ type: 'replace', state: persisted });
    }
  }, []);

  // Persist on every state change. After hydrate, write the initial
  // state too (covers the case where hydrate produces the initial
  // shape and a later add must persist a non-empty list).
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveWorkspaceState(state);
  }, [state]);

  // Per-tab last-activated index for PR #5 LRU. Reset on activeId
  // change. Created on first add so empty workspaces don't allocate.
  const lastActivatedAtRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (state.activeId) {
      lastActivatedAtRef.current.set(state.activeId, Date.now());
    }
  }, [state.activeId]);

  // PR #5 — LRU freeze. cap 은 viewport 기반 — desktop 8 / mobile 5 (PLAN
  // §2). matchMedia 로 변경 감지. cap 초과 시 alive 탭에서 가장 오래
  // 미활성된 후보를 freezeTab dispatch. activeId 는 LRU 알고리즘에서
  // 보호되므로 절대 freeze 안 됨.
  const [cap, setCap] = useState(DESKTOP_CAP);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const update = (): void => setCap(mq.matches ? DESKTOP_CAP : MOBILE_CAP);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const decision = applyCapPolicy(state, cap, lastActivatedAtRef.current);
    if (decision.freezeCandidates.length === 0) return;
    for (const id of decision.freezeCandidates) {
      dispatch({ type: 'freezeTab', id });
    }
  }, [state, cap]);

  const addTab = useCallback(
    (
      input:
        | { kind: 'chat'; sessionId?: string; title?: string }
        | { kind: Exclude<WorkspaceTabKind, 'chat'> },
    ): string => {
      const id = generateTabId();
      let tab: WorkspaceTab;
      if (input.kind === 'chat') {
        const sessionId = input.sessionId ?? generateSessionId();
        tab = makeChatTab({
          id,
          sessionId,
          ...(input.title !== undefined ? { title: input.title } : {}),
        });
      } else {
        tab = makeSingleTab({ id, kind: input.kind });
      }
      dispatch({ type: 'addTab', tab });
      return id;
    },
    [],
  );

  const closeTab = useCallback((id: string): void => {
    dispatch({ type: 'closeTab', id });
    lastActivatedAtRef.current.delete(id);
  }, []);

  const activateTab = useCallback((id: string): void => {
    dispatch({ type: 'activateTab', id });
  }, []);

  const reorderTab = useCallback((id: string, toIndex: number): void => {
    dispatch({ type: 'reorderTab', id, toIndex });
  }, []);

  const updateChatTab = useCallback(
    (id: string, patch: { sessionId?: string; title?: string }): void => {
      dispatch({ type: 'updateTab', id, patch });
    },
    [],
  );

  const activateOrAdd = useCallback(
    (kind: WorkspaceTabKind): string | null => {
      if (kind === 'chat') {
        // chat 은 multi-instance — 호출자가 picker 모달을 거쳐야 함.
        // 이 경로로 chat 들어오면 정책 misuse 로 보고 null.
        return null;
      }
      if (isSingleInstanceKind(kind)) {
        const existing = state.tabs.find((t) => t.kind === kind);
        if (existing) {
          dispatch({ type: 'activateTab', id: existing.id });
          return existing.id;
        }
      }
      return addTab({ kind });
    },
    [state.tabs, addTab],
  );

  const openPicker = useCallback((mode: PickerMode): void => {
    setPickerMode(mode);
  }, []);

  const closePicker = useCallback((): void => {
    setPickerMode(null);
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      addTab,
      closeTab,
      activateTab,
      reorderTab,
      updateChatTab,
      activateOrAdd,
      pickerMode,
      openPicker,
      closePicker,
    }),
    [state, addTab, closeTab, activateTab, reorderTab, updateChatTab, activateOrAdd, pickerMode, openPicker, closePicker],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  }
  return ctx;
}

/** Optional accessor — single-tab `/chat` 페이지처럼 WorkspaceProvider
 *  바깥에서도 호출 가능. workspace 안일 때만 attach/forget 콜백 wire
 *  하기 위한 용도. */
export function useWorkspaceOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
