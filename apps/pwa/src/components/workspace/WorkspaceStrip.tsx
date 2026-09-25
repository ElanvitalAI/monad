'use client';

// PR #3 + PR #4 — 워크스페이스 strip.
//
// 데스크탑 (md+): 풀 strip · 모든 탭 · `+` popover.
// 모바일 (<md): 압축 strip · 활성 탭 라벨 + `⋮ N more` 카운트 + `+`.
// 모바일 swipe (좌→우 = 이전 탭, 우→좌 = 다음 탭) 는 활성 영역 전체에
// 부착 (TabPickerModal 의 부모 컨테이너에서 attachSwipe).

import { useEffect, useRef, useState } from 'react';
import { X, MessageSquare, TerminalSquare, ClipboardList, GitBranch, KanbanSquare, Sliders, Settings, MoreVertical } from 'lucide-react';
import { useWorkspace } from './WorkspaceProvider';
import { AddTabPopover } from './AddTabPopover';
import { TabPickerModal } from './TabPickerModal';
import type { WorkspaceTab, WorkspaceTabKind } from '@/lib/workspace/types';
import { tabsInOrder } from '@/lib/workspace/store';
import { cn } from '@/lib/utils';

// Phase 2 (PWA chat ↔ voice 일원화 · 2026-05-07) — 'voice' kind 제거.
// Surface-unification v2.2 V2.2-6 (2026-05-11) — 'scheduler' kind 제거.
const KIND_ICON: Record<WorkspaceTabKind, typeof MessageSquare> = {
  chat: MessageSquare,
  term: TerminalSquare,
  intake: ClipboardList,
  tasks: KanbanSquare,
  workflows: GitBranch,
  control: Sliders,
  settings: Settings,
};

function tabLabel(tab: WorkspaceTab, chatIndex: number): string {
  if (tab.kind === 'chat') return tab.title ?? `chat#${chatIndex}`;
  if (tab.kind === 'term') return 'terminal';
  if (tab.kind === 'tasks') return 'tasks';
  return tab.kind;
}

export function WorkspaceStrip() {
  const { state, activateTab, closeTab } = useWorkspace();
  const ordered = tabsInOrder(state);
  const [pickerOpen, setPickerOpen] = useState(false);

  // chat#N 인덱스 산출 — order 순서대로 chat 만 카운트.
  const chatIndexById = new Map<string, number>();
  let chatCount = 0;
  for (const t of ordered) {
    if (t.kind === 'chat') {
      chatCount += 1;
      chatIndexById.set(t.id, chatCount);
    }
  }

  const activeTab = ordered.find((t) => t.id === state.activeId);
  const activeIdx = activeTab?.kind === 'chat'
    ? chatIndexById.get(activeTab.id) ?? 0
    : 0;
  const inactiveCount = Math.max(0, ordered.length - (activeTab ? 1 : 0));

  return (
    <>
      {/* 데스크탑 풀 strip */}
      <div
        role="tablist"
        aria-label="workspace tabs"
        className="hidden md:flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background px-2"
      >
        {ordered.map((tab) => {
          const Icon = KIND_ICON[tab.kind];
          const active = state.activeId === tab.id;
          const idx = tab.kind === 'chat' ? chatIndexById.get(tab.id) ?? 0 : 0;
          const label = tabLabel(tab, idx);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => activateTab(tab.id)}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer',
                active
                  ? 'bg-primary/15 text-foreground ring-1 ring-primary/40'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[140px] truncate">{label}</span>
              <button
                type="button"
                aria-label={`close ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-100"
                data-active={active ? 'true' : 'false'}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <AddTabPopover />
      </div>

      {/* 모바일 압축 strip */}
      <div
        role="tablist"
        aria-label="workspace tabs (compact)"
        className="flex md:hidden h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2"
      >
        {activeTab ? (
          <div className="flex flex-1 min-w-0 items-center gap-1.5 rounded-md bg-primary/15 px-2 py-1 text-xs font-medium ring-1 ring-primary/40">
            {(() => {
              const Icon = KIND_ICON[activeTab.kind];
              return <Icon className="h-3.5 w-3.5 shrink-0" />;
            })()}
            <span className="flex-1 truncate">{tabLabel(activeTab, activeIdx)}</span>
            <button
              type="button"
              aria-label="close"
              onClick={() => closeTab(activeTab.id)}
              className="inline-flex h-4 w-4 items-center justify-center rounded hover:bg-background"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <span className="flex-1 px-2 text-xs text-muted-foreground">탭 없음</span>
        )}
        {inactiveCount > 0 && (
          <button
            type="button"
            aria-label={`other tabs (${inactiveCount})`}
            onClick={() => setPickerOpen(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <MoreVertical className="h-3.5 w-3.5" />
            <span>{inactiveCount}</span>
          </button>
        )}
        <AddTabPopover />
      </div>

      <TabPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
