'use client';

// PR #6 — `/workspace` 키보드 단축키. WorkspaceProvider 안에서만 mount
// 되므로 다른 페이지에서는 자동 비활성. (PR #6 회귀 가드 — 단축키가
// /chat, /term 같은 single-tab 페이지에 새 영향 X)
//
// 단축키:
//   ⌘T          — 새 chat 탭 (picker 열기)
//   ⌘W          — 활성 탭 닫기 (마지막 탭이면 무시 = workspace 자체는
//                  empty state 로 남김)
//   ⌘1..⌘9      — 그 인덱스 탭 활성 (order 기반)
//   ⌘Shift+]    — 다음 인접 탭
//   ⌘Shift+[    — 이전 인접 탭
//
// browser 의 `Cmd+T` 가 새 브라우저 탭 여는 default 와 충돌 — `e.preventDefault()`
// 로 가로채지만, 일부 브라우저 (Safari) 는 OS 차원에서 중복 못 막음.
// 그래도 PWA 컨텍스트 안에서는 대부분 동작.

import { useEffect } from 'react';
import { useWorkspace } from './WorkspaceProvider';
import { tabsInOrder } from '@/lib/workspace/store';

export function WorkspaceShortcuts() {
  const ws = useWorkspace();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      const ordered = tabsInOrder(ws.state);
      const activeIdx = ws.state.activeId
        ? ordered.findIndex((t) => t.id === ws.state.activeId)
        : -1;

      // ⌘T — 새 chat (picker)
      if (!e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        ws.openPicker({ kind: 'addNewChat' });
        return;
      }
      // ⌘W — 활성 탭 닫기
      if (!e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (ws.state.activeId && ordered.length > 0) {
          ws.closeTab(ws.state.activeId);
        }
        return;
      }
      // ⌘Shift+] / ⌘Shift+[ — 인접 탭
      if (e.shiftKey && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        if (ordered.length <= 1 || activeIdx < 0) return;
        const nextIdx = e.key === ']'
          ? (activeIdx + 1) % ordered.length
          : (activeIdx - 1 + ordered.length) % ordered.length;
        ws.activateTab(ordered[nextIdx].id);
        return;
      }
      // ⌘1..⌘9 — 인덱스 jump
      if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const i = parseInt(e.key, 10) - 1;
        if (i >= ordered.length) return;
        ws.activateTab(ordered[i].id);
        return;
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ws]);

  return null;
}
