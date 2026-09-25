'use client';

// PR #3 / PR #4.5 — `/workspace` 진입점. Provider · Strip · Canvas ·
// SessionPicker 한 column.
//
// 2026-05-06 — sidebar nav workspace 통합 (BACKLOG-webterm-followups §4).
// SidebarNav 가 /workspace?intent=<kind> 로 push → 본 페이지가 query 보고
// activateOrAdd (single-instance) 또는 openPicker (chat) 호출. 처리 후
// router.replace 로 query 제거 (브라우저 history 오염 방지).

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
// 2026-05-07 — WorkspaceProvider 가 AppShell 로 lifted 되어 본 page
// 는 더 이상 자체 mount 안 함 (nested provider 가 새 빈 state 를
// 만들어 strip 과 본 페이지가 분리되는 회귀 회피).
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { WorkspaceCanvas } from '@/components/workspace/WorkspaceCanvas';
import { WorkspaceShortcuts } from '@/components/workspace/WorkspaceShortcuts';
import { SessionPicker } from '@/components/chat/SessionPicker';
import type { WorkspaceTabKind } from '@/lib/workspace/types';
import { tabsInOrder } from '@/lib/workspace/store';

// Phase 2 (PWA chat ↔ voice 일원화 · 2026-05-07) — 'voice' intent 제거.
// Surface-unification v2.2 V2.2-6 (2026-05-11) — 'scheduler' intent 제거
// (workflow scheduleTrigger 흡수). 외부에서 ?intent=scheduler 들어오면
// unknown kind 로 분기되어 query 만 정리.
const VALID_INTENT_KINDS: ReadonlySet<WorkspaceTabKind> = new Set([
  'chat',
  'term',
  'intake',
  'tasks',
  'control',
  'settings',
]);

function WorkspaceWithPicker() {
  const ws = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const intentRaw = searchParams?.get('intent') ?? null;

  // SidebarNav 가 push 한 ?intent=<kind> 를 처리. 한 번만 실행 (탭 전환마다
  // 재실행되지 않도록 ref 가드). chat 은 multi-instance 라 activateOrAdd 가
  // 안 됨 → 기존 chat 탭 있으면 첫 번째 활성, 없으면 SessionPicker 열기
  // (사용자가 기존 세션 attach 또는 새 세션 결정).
  const handledIntentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!intentRaw) return;
    if (handledIntentRef.current === intentRaw) return;
    if (!VALID_INTENT_KINDS.has(intentRaw as WorkspaceTabKind)) {
      // unknown kind — 그냥 query 만 제거
      router.replace('/workspace' as never);
      return;
    }
    handledIntentRef.current = intentRaw;
    const kind = intentRaw as WorkspaceTabKind;
    if (kind === 'chat') {
      const ordered = tabsInOrder(ws.state);
      const firstChat = ordered.find((t) => t.kind === 'chat');
      if (firstChat) {
        ws.activateTab(firstChat.id);
      } else {
        ws.openPicker({ kind: 'addNewChat' });
      }
    } else {
      ws.activateOrAdd(kind);
    }
    router.replace('/workspace' as never);
  }, [intentRaw, ws, router]);

  // attached map: sessionId → { tabId, label } — picker 가 `✓ open in
  // chat#N` 마킹용. chat#N 인덱스는 order 순서대로 재산출.
  const attached = useMemo(() => {
    const out = new Map<string, { tabId: string; label: string }>();
    let chatIdx = 0;
    for (const id of ws.state.order) {
      const tab = ws.state.tabs.find((t) => t.id === id);
      if (!tab || tab.kind !== 'chat') continue;
      chatIdx += 1;
      out.set(tab.sessionId, { tabId: tab.id, label: `chat#${chatIdx}` });
    }
    return out;
  }, [ws.state.order, ws.state.tabs]);

  const handlePick = (
    pick:
      | { kind: 'new'; sessionId: string }
      | { kind: 'existing'; sessionId: string }
      | { kind: 'jumpToTab'; tabId: string },
  ): void => {
    const mode = ws.pickerMode;
    if (!mode) return;
    if (pick.kind === 'jumpToTab') {
      ws.activateTab(pick.tabId);
    } else if (mode.kind === 'addNewChat') {
      ws.addTab({ kind: 'chat', sessionId: pick.sessionId });
    } else if (mode.kind === 'attachToTab') {
      ws.updateChatTab(mode.tabId, { sessionId: pick.sessionId });
      ws.activateTab(mode.tabId);
    }
    ws.closePicker();
  };

  // 2026-05-07 — WorkspaceStrip 은 TopBar 안 inline 으로 mount 되었
  // 으므로 본 page 의 column 에서 제거. WorkspaceShortcuts (전역 키
  // 핸들러) + Canvas + SessionPicker 만 유지.
  return (
    <div className="flex h-full flex-col">
      <WorkspaceShortcuts />
      <div className="flex-1 min-h-0">
        <WorkspaceCanvas />
      </div>
      <SessionPicker
        open={ws.pickerMode !== null}
        onClose={ws.closePicker}
        onPick={handlePick}
        attachedSessions={attached}
      />
    </div>
  );
}

export default function WorkspacePage() {
  // WorkspaceProvider 는 AppShell 에서 mount 되므로 여기는 Suspense
  // boundary + 페이지 내용만.
  return (
    <Suspense fallback={<div className="h-full" />}>
      <WorkspaceWithPicker />
    </Suspense>
  );
}
